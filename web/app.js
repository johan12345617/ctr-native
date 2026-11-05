"use strict";

const canvas = document.getElementById("canvas");
const disc = document.getElementById("disc");
const start = document.getElementById("start");
const fullscreen = document.getElementById("fullscreen");
const keyboardPlayer = document.getElementById("keyboard-player");
const status = document.getElementById("status");
let runtime;
let selectedDisc;
let running = false;
let starting = false;
let failed = false;
let persistent = false;
let syncing = false;
let runtimePromise;
let onlineRole = null;
const captureReleases = new WeakMap();

function setStatus(message) { status.textContent = message; }
function updateStart() { start.disabled = !runtime || !selectedDisc || starting || running || failed; }
function fail(message) {
  failed = true;
  running = false;
  setStatus(message);
  start.disabled = fullscreen.disabled = keyboardPlayer.disabled = true;
  window.dispatchEvent(new Event("ctr-game-stopped"));
}
function syncSaves(populate = false) {
  return new Promise((resolve, reject) => runtime.FS.syncfs(populate, error => error ? reject(error) : resolve()));
}
async function flushSaves() {
  if (!persistent || syncing) return;
  syncing = true;
  try { await syncSaves(); }
  catch (error) {
    persistent = false;
    setStatus("Browser storage could not save your progress. Keep this tab open; changes may be lost on reload.");
    console.error(error);
  } finally { syncing = false; }
}

async function loadRuntime() {
  if (!window.WebAssembly || !document.createElement("canvas").getContext("webgl2")) {
    throw new Error("This browser needs WebAssembly and WebGL2. Try a current browser with hardware acceleration enabled.");
  }
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "ctr_native.js";
    script.onload = resolve;
    script.onerror = () => reject(new Error("The game engine could not load. Build the web target and serve the build-web folder over HTTP."));
    document.head.append(script);
  });
  runtime = await window.createCTRModule({
    canvas,
    noInitialRun: true,
    print: message => console.log(message),
    printErr: message => console.error(message),
    onAbort: reason => fail("The game stopped: " + reason + ". Reload this page to try again."),
    onExit: code => fail("The game exited (" + code + "). Reload this page to try again."),
  });
  runtime.FS.mkdirTree("/assets");
  runtime.FS.mkdirTree("/memcards");
  try {
    runtime.FS.mount(runtime.IDBFS, { autoPersist: true }, "/memcards");
    await syncSaves(true);
    persistent = true;
  } catch (error) {
    // Leave a usable in-memory mount when browser storage is unavailable.
    console.warn("Persistent saves unavailable", error);
    try { runtime.FS.unmount("/memcards"); } catch {}
  }
  setStatus(persistent
    ? "Engine ready. Choose your disc, then start the game."
    : "Engine ready. Browser storage is unavailable; saves will last only for this tab.");
  updateStart();
}
function ensureRuntime() {
  return runtimePromise ||= loadRuntime();
}

disc.addEventListener("change", async () => {
  selectedDisc = undefined;
  updateStart();
  const file = disc.files[0];
  if (!file) return;
  setStatus("Checking your disc…");
  try {
    if (file.size < 17 * 2352 || file.size % 2352 !== 0) {
      throw new Error("Choose a raw MODE2/2352 .bin disc image.");
    }
    const header = new Uint8Array(await file.slice(16 * 2352 + 24, 16 * 2352 + 31).arrayBuffer());
    if (header[0] !== 1 || String.fromCharCode(...header.slice(1, 6)) !== "CD001" || header[6] !== 1) {
      throw new Error("This file is not a supported raw disc image. Select the NTSC-U MODE2/2352 .bin file.");
    }
    if (disc.files[0] !== file) return;
    selectedDisc = file;
    setStatus(file.name + " selected. " + (runtime ? "Ready to start." : "Waiting for the game engine…"));
    await ensureRuntime();
  } catch (error) {
    if (disc.files[0] === file) setStatus(error.message);
  }
  updateStart();
});

async function startGame() {
  if (running) return;
  if (!selectedDisc) throw new Error("Choose your game disc below before creating a lobby.");
  if (starting) throw new Error("The game is still starting. Try again in a moment.");
  starting = true;
  disc.disabled = true;
  updateStart();
  setStatus("Opening your disc locally… This may take a moment.");
  try {
    await ensureRuntime();
    // canOwn avoids a second full copy of the large retail image in MEMFS.
    const bytes = new Uint8Array(await selectedDisc.arrayBuffer());
    runtime.FS.writeFile("/assets/ctr-u.bin", bytes, { canOwn: true });
    runtime.FS.chdir("/");
    canvas.focus();
    running = true;
    runtime.callMain([]);
    if (failed) throw new Error("The game could not initialize.");
    keyboardPlayer.value = String(runtime._CTR_WebGetKeyboardPlayer());
    fullscreen.disabled = keyboardPlayer.disabled = false;
    document.getElementById("screen-label").textContent = "Click the screen to focus · Use Enter to start or pause";
    setStatus(persistent ? "Game running. Memory-card saves are stored in this browser." : "Game running. Saves last only for this tab.");
  } catch (error) {
    fail("Could not start the game: " + error.message + ". Reload and select a supported NTSC-U disc.");
    console.error(error);
    throw error;
  } finally { starting = false; }
}
start.addEventListener("click", () => { void startGame().catch(() => {}); });

keyboardPlayer.addEventListener("change", () => {
  if (running) runtime._CTR_WebSetKeyboardPlayer(Number(keyboardPlayer.value));
  canvas.focus();
});
fullscreen.addEventListener("click", async () => {
  try {
    const screen = onlineRole === "guest" ? document.getElementById("guest-video") : canvas;
    if (!screen.requestFullscreen) throw new Error("Fullscreen is unavailable in this browser.");
    await screen.requestFullscreen();
    screen.focus();
  } catch (error) {
    if (onlineRole) document.getElementById("online-status").textContent = error.message;
    else setStatus(error.message);
  }
});
canvas.addEventListener("click", () => canvas.focus());
canvas.addEventListener("contextmenu", event => event.preventDefault());
canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  fail("The graphics context was lost. Reload this page to restart the game.");
});
canvas.addEventListener("keydown", event => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(event.code)) event.preventDefault();
});
window.addEventListener("pagehide", () => { void flushSaves(); });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (runtime) for (let slot = 0; slot < 4; slot++) runtime._CTR_WebClearPad(slot);
    void flushSaves();
  }
});
setInterval(() => { if (running) void flushSaves(); }, 5000);
// SDL can move the keyboard to another slot when a gamepad connects.
setInterval(() => {
  if (running && onlineRole !== "guest" && document.activeElement !== keyboardPlayer) {
    keyboardPlayer.value = String(runtime._CTR_WebGetKeyboardPlayer());
  }
}, 1000);

// The lobby binds each peer to its server-assigned controller slot.
window.ctrHost = Object.freeze({
  get running() { return running; },
  canvas,
  ensureRunning: startGame,
  setKeyboardPlayer(slot) {
    if (!running || !Number.isInteger(slot) || slot < 0 || slot > 3) return false;
    keyboardPlayer.value = String(slot);
    return runtime._CTR_WebSetKeyboardPlayer(slot) === 1;
  },
  setPad(slot, buttons, rightX = 128, rightY = 128, leftX = 128, leftY = 128) {
    const values = [slot, buttons, rightX, rightY, leftX, leftY];
    if (!running || !values.every(Number.isInteger) || slot < 0 || slot > 3 ||
        buttons < 0 || buttons > 65535 || values.slice(2).some(value => value < 0 || value > 255)) return false;
    return runtime._CTR_WebSetPad(...values) === 1;
  },
  clearPad(slot) {
    return !!runtime && Number.isInteger(slot) && slot >= 0 && slot < 4 && runtime._CTR_WebClearPad(slot) === 1;
  },
  captureVideo(fps = 30) {
    if (!running) throw new Error("Start the game before capturing its screen.");
    if (!Number.isFinite(fps) || fps < 1 || fps > 60) throw new Error("Capture rate must be between 1 and 60 fps.");
    if (!canvas.captureStream) throw new Error("Canvas streaming is unavailable in this browser.");
    return canvas.captureStream(fps);
  },
  async captureStream() {
    const stream = this.captureVideo(30);
    try {
      // SDL opens Web Audio after its first initialization VBlanks.
      const deadline = performance.now() + 5000;
      while (!runtime.SDL3?.audio_playback?.scriptProcessorNode && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const context = runtime.SDL3?.audioContext;
      const source = runtime.SDL3?.audio_playback?.scriptProcessorNode;
      if (!context || !source) throw new Error("Game audio is still loading. Wait a moment, then create the lobby again.");
      await context.resume();
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
      captureReleases.set(stream, () => { try { source.disconnect(destination); } catch {} });
      return stream;
    } catch (error) {
      stream.getTracks().forEach(track => track.stop());
      throw error;
    }
  },
  releaseStream(stream) {
    captureReleases.get(stream)?.();
    captureReleases.delete(stream);
    stream.getTracks().forEach(track => track.stop());
  },
});

import("./online.js").then(({ initOnline }) => {
  initOnline(window.ctrHost, role => {
    onlineRole = role;
    const guest = role === "guest";
    document.getElementById("local-setup").hidden = !!role;
    document.getElementById("keyboard-player-label").hidden = !!role;
    document.getElementById("multiplayer-label").textContent = guest ? "Your controller" : "Local multiplayer";
    document.getElementById("multiplayer-value").textContent = guest ? "Keyboard or gamepad" : "Up to 4 gamepads";
    document.getElementById("controls-help").textContent = guest
      ? "Click the shared screen to use your keyboard or a standard gamepad. The host chooses the game mode and player count. Your controls are released when you leave the screen or lobby. Saves stay on the host."
      : "Press a button to connect a gamepad, then select a multiplayer mode in the game. Click the game screen to use the keyboard. In-game memory-card saves are kept in this browser when storage is available.";
    canvas.hidden = guest;
    document.getElementById("guest-video").hidden = !guest;
    document.getElementById("guest-audio").hidden = !guest;
    keyboardPlayer.disabled = !running || role === "host";
    fullscreen.disabled = !running && !guest;
    document.getElementById("screen-label").textContent = guest
      ? "Host's shared screen · Click to focus your controls"
      : running ? "Click the screen to focus · Use Enter to start or pause" : "Select a disc to get on the grid.";
  });
}).catch(error => {
  document.getElementById("online-status").textContent = "Online menu could not load. Rebuild the web target and reload.";
  console.error(error);
});

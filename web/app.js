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
let factoryPromise;
let onlineRole = null;
let playMode = "local";
let raceLobby, streamingLobby;
let raceActive = false, raceRunning = false;
let shellTimer, stoppingShell = false, shellScheduled = false;
let gamepads, focusGamepadScreen;
const captureReleases = new WeakMap();

function setStatus(message) { status.textContent = message; }
function updateStart() {
  start.disabled = !window.createCTRModule || !selectedDisc || starting || running || failed || raceActive;
}
function fail(message) {
  clearInterval(shellTimer);
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

async function ensureFactory() {
  if (window.createCTRModule) return;
  if (factoryPromise) return factoryPromise;
  if (!window.WebAssembly || !document.createElement("canvas").getContext("webgl2")) {
    throw new Error("This browser needs WebAssembly and WebGL2. Try a current browser with hardware acceleration enabled.");
  }
  return factoryPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "ctr_native.js";
    script.onload = resolve;
    script.onerror = () => {
      factoryPromise = undefined;
      script.remove();
      reject(new Error("The game engine could not load. Reload this page and try again."));
    };
    document.head.append(script);
  });
}
async function loadRuntime() {
  await ensureFactory();
  const input = await import("./input.js");
  gamepads ||= new input.BrowserGamepads(); focusGamepadScreen = input.focusGamepadScreen;
  runtime = await window.createCTRModule({
    canvas,
    noInitialRun: true,
    print: message => console.log(message),
    printErr: message => console.error(message),
    onAbort: reason => fail("The game stopped: " + reason + ". Reload this page to try again."),
    onExit: code => { if (!shellScheduled) fail("The game exited (" + code + "). Reload this page to try again."); },
  });
  runtime.FS.mkdirTree("/assets");
  runtime.ctrGamepadRumble = (slot, strong, weak) => gamepads.rumble(slot, strong, weak);
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
  window.dispatchEvent(new Event("ctr-disc-ready"));
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
    setStatus(file.name + " selected. Loading the game engine…");
    // A disc selection loads the factory, not an unused local game runtime.
    // Online races create their own fresh module when entering the lobby.
    await ensureFactory();
    if (disc.files[0] !== file) return;
    setStatus(file.name + " ready. Click Start game" + (playMode === "race" ? " to open the Online lobby." : ", then choose a mode in the game."));
  } catch (error) {
    if (disc.files[0] === file) setStatus(error.message);
  }
  updateStart();
  window.dispatchEvent(new Event("ctr-disc-ready"));
});

async function startGame() {
  if (raceActive) throw new Error("Leave the online session first.");
  if (running) return;
  if (!selectedDisc) throw new Error("Choose your game disc, then click Start game to open Online.");
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
    if (runtime._CTR_WebShellConfigure() !== 1) throw new Error("The engine menu could not initialize.");
    gamepads.apply(runtime, document.hidden);
    shellScheduled = true;
    canvas.focus();
    running = true;
    runtime.callMain([]);
    shellTimer = setInterval(() => {
      try {
        if (!runtime) return;
        focusGamepadScreen(canvas, gamepads.apply(runtime, document.hidden));
        if (!runtime._CTR_WebShellStep()) fail("The game stopped. Reload to try again.");
      }
      catch (error) { fail(error.message); }
    }, 1000 * 2 * 897619 / 53693175);
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
async function stopShell() {
  clearInterval(shellTimer);
  if (!runtime) return;
  await flushSaves();
  stoppingShell = true;
  runtime._CTR_WebShellShutdown();
  try { runtime.FS.unlink("/assets/ctr-u.bin"); } catch {}
  runtime = runtimePromise = undefined; running = false; persistent = false; shellScheduled = false;
}
start.addEventListener("click", () => {
  void (playMode === "race" ? raceLobby.open() : startGame()).catch(error => setStatus(error.message));
});

keyboardPlayer.addEventListener("change", () => {
  if (running) runtime._CTR_WebSetKeyboardPlayer(Number(keyboardPlayer.value));
  canvas.focus();
});
fullscreen.addEventListener("click", async () => {
  try {
    const screen = playMode === "race" ? document.getElementById("game-surface")
      : onlineRole === "guest" ? document.getElementById("guest-video") : canvas;
    if (!screen.requestFullscreen) throw new Error("Fullscreen is unavailable in this browser.");
    await screen.requestFullscreen();
    (playMode === "race" ? canvas : screen).focus();
  } catch (error) {
    if (playMode === "race") raceLobby?.showMessage(error.message);
    else if (onlineRole) document.getElementById("online-status").textContent = error.message;
    else setStatus(error.message);
  }
});
canvas.addEventListener("click", () => canvas.focus());
canvas.addEventListener("contextmenu", event => event.preventDefault());
canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  if (stoppingShell) return;
  if (raceActive) raceLobby?.close("The graphics context was lost. Refresh this page and join a new lobby.");
  else fail("The graphics context was lost. Reload this page to restart the game.");
});
canvas.addEventListener("keydown", event => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
});
// SDL consumes Tab on its own keyboard listener. Keep native browser focus
// navigation available before that listener runs, including after a new race.
window.addEventListener("keydown", event => {
  if (event.code === "Tab" && document.activeElement === canvas) event.stopImmediatePropagation();
}, { capture: true });
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

function selectMode(mode) {
  if (mode === playMode && mode === "stream" && onlineRole) return true;
  if (mode !== "race" && raceLobby?.active) {
    raceLobby.showMessage("Leave or close your lobby before changing play mode.");
    return false;
  }
  if (mode !== "stream" && streamingLobby?.active) {
    document.getElementById("online-status").textContent = "Leave or close your shared-screen lobby before changing play mode.";
    return false;
  }
  playMode = mode;
  document.getElementById("online-panel").hidden = mode !== "stream";
  document.getElementById("mode-online").setAttribute("aria-expanded", String(mode === "stream"));
  document.getElementById("mode-race").setAttribute("aria-expanded", String(mode === "race"));
  document.getElementById("mode-local").setAttribute("aria-pressed", String(mode === "local"));
  document.getElementById("keyboard-player-label").hidden = mode === "race";
  raceLobby?.setVisible(mode === "race");
  disc.disabled = running || starting || raceActive;
  document.getElementById("multiplayer-label").textContent = mode === "race" ? "Online race" : "Local multiplayer";
  document.getElementById("multiplayer-value").textContent = mode === "race" ? "Your own camera" : "Up to 4 gamepads";
  document.getElementById("controls-help").textContent = mode === "race"
    ? "Choose Online inside the engine to create or join with a code. The host starts the session, then chooses Race, Cup or Battle. Each player selects their own character."
    : "Press a button to connect a gamepad, then select a multiplayer mode in the game. Click the game screen to use the keyboard. In-game memory-card saves are kept in this browser when storage is available.";
  document.getElementById("screen-label").textContent = mode === "race" ? "Online · Use the game menus"
    : running ? "Click the screen to focus · Use Enter to start or pause" : "Select a disc to get on the grid.";
  fullscreen.disabled = !(running || raceRunning);
  document.getElementById("race-latency").hidden = mode !== "race" || !raceActive;
  updateStart();
  return true;
}

Promise.all([import("./online.js"), import("./online-v2-engine.js")]).then(([{ initOnline }, { initEngineOnline }]) => {
  raceLobby = initEngineOnline({
    canvas, getDisc: () => selectedDisc, getShell: () => runtime, startShell: startGame, stopShell,
    onMessage: setStatus,
    createModule: async options => { await ensureFactory(); const module = await window.createCTRModule(options); stoppingShell = false; return module; },
    onSessionChange({ active, running: racing }) {
      raceActive = active; raceRunning = racing;
      if (active && playMode !== "race") selectMode("race");
      disc.disabled = active || running || starting;
      if (playMode === "race") {
        fullscreen.disabled = !(racing || running);
        document.getElementById("screen-label").textContent = racing ? "Your camera · Click to focus your controls"
          : active ? "Online race · Loading the lobby" : "Online race · Create or join a lobby";
      }
      updateStart();
    },
  });
  document.getElementById("mode-race").addEventListener("click", () => {
    if (selectMode("race")) void raceLobby.open().catch(error => setStatus(error.message));
  });
  window.ctrEngine = Object.freeze({ get module() { return raceLobby.module; }, get online() { return raceLobby.active; } });
  streamingLobby = initOnline(window.ctrHost, role => {
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
  }, { onModeRequest: selectMode });
}).catch(error => {
  document.getElementById("online-status").textContent = "Online menu could not load. Rebuild the web target and reload.";
  console.error(error);
});

// Browsers cannot open a Windows path directly. The local Node server streams
// this checkout's exact assets/ctr-u.bin through a loopback-only route.
void (async () => {
  try {
    const response = await fetch("/local-disc", { cache: "no-store" });
    if (!response.ok) return;
    if (selectedDisc || disc.files.length) { await response.body?.cancel(); return; }
    setStatus("Loading assets/ctr-u.bin from this computer…");
    const file = new File([await response.blob()], "ctr-u.bin", { type: "application/octet-stream" });
    if (selectedDisc || disc.files.length) return;
    const transfer = new DataTransfer(); transfer.items.add(file); disc.files = transfer.files;
    disc.dispatchEvent(new Event("change"));
  } catch { /* A missing local disc keeps the normal file picker available. */ }
})();

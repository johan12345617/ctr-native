import { OnlineV2Client } from "./online-v2-client.js";

// The engine draws and operates the lobby. This adapter only transfers room
// lifecycle events and hands the canvas from a local menu to a synced runtime.
export function initEngineOnline({ canvas, getDisc, getShell, startShell, stopShell, createModule, onSessionChange, onMessage }) {
  let client, code = 0, slot = 0, ready = 0, phase = 0, enabled = false, wantOpen = false, ending = false, requestTimer;
  const module = () => client?.simulation?.module || getShell();
  const update = () => module()?._CTR_WebLobbyStatus(phase, code, slot, ready);
  function state(next) { phase = next; update(); }
  async function end(message = "Lobby closed.", failure = false) {
    if (ending) return;
    ending = true;
    clearTimeout(requestTimer);
    const previous = client; client = undefined;
    const hadSimulation = !!previous?.simulation;
    previous?.close(); phase = failure ? 5 : 0; code = ready = 0;
    document.getElementById("race-latency").hidden = true;
    onSessionChange({ active: false, running: false });
    if (hadSimulation || !getShell()) await startShell();
    wantOpen = true; update(); onMessage(message); ending = false;
  }
  async function enter(join) {
    if (client || !getDisc()) return;
    state(2); onSessionChange({ active: true, running: false });
    try {
      const current = client = new OnlineV2Client({ createModule, disc: getDisc(), canvas, beforeLoad: stopShell,
        onStatus(message) {
          if (client !== current) return;
          if (message.type === "lobby") {
            clearTimeout(requestTimer);
            code = parseInt(message.code, 16); slot = message.slot; state(3);
          } else if (message.type === "players") {
            ready = message.players.reduce((bits, player) => bits | (player.ready ? 1 << player.slot : 0), 0); update();
          } else if (message.type === "booting" || message.type === "loading") state(4);
          else if (message.type === "loaded") { phase = 0; update(); }
          else if (message.type === "started") {
            phase = 0; update(); onSessionChange({ active: true, running: true }); canvas.focus();
          } else if (message.type === "latency") {
            const label = document.getElementById("race-latency");
            label.textContent = Math.round(message.rttMs) + " ms ping"; label.hidden = false;
          } else if (message.type === "error") void end(message.message, true);
          else if (message.type === "closed") void end(message.reason, true);
        },
      });
      requestTimer = setTimeout(() => { if (client === current && phase === 2) void end("The lobby server did not respond. Try again.", true); }, 30000);
      if (join) await current.join(join);
      else await current.create({ flow: "menu", seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    } catch (error) { await end(error.message, true); }
  }
  window.addEventListener("keydown", event => {
    const current = module();
    if (document.activeElement !== canvas || !current || !current._CTR_WebMenuInfo(3)) return;
    if (!client?.simulation && (event.code === "KeyV" || event.key === "Escape")) {
      event.preventDefault(); event.stopImmediatePropagation(); current._CTR_WebLobbyKey(27); return;
    }
    if (current._CTR_WebMenuInfo(4) !== 1 || current._CTR_WebMenuInfo(5) >= 2) return;
    if (/^[0-9a-f]$/i.test(event.key) || event.key === "Backspace") {
      event.preventDefault(); event.stopImmediatePropagation();
      current._CTR_WebLobbyKey(event.key === "Backspace" ? 8 : event.key.toUpperCase().charCodeAt(0));
    }
  }, { capture: true });
  setInterval(() => {
    const current = module();
    if (!current) return;
    current._CTR_WebLobbyAvailable(enabled ? 1 : 0);
    if (wantOpen && current._CTR_WebMenuInfo(0) === 3 && current._CTR_WebMenuInfo(1) === -1) {
      current._CTR_WebLobbyOpen(); wantOpen = false;
    }
    const action = current._CTR_WebLobbyAction();
    if (action === 1) void enter();
    else if (action === 2) void enter(current._CTR_WebLobbyCode().toString(16).padStart(6, "0"));
    else if (action === 3) { if (client) void end(); else { phase = 0; update(); } }
    else if (action === 4) client?.start();
    else if (action === 5) void navigator.clipboard?.writeText(code.toString(16).toUpperCase().padStart(6, "0"))
      .then(() => onMessage("Lobby code copied."), () => onMessage("Lobby code: " + code.toString(16).toUpperCase().padStart(6, "0")));
  }, 50);
  void fetch("/health", { cache: "no-store" }).then(response => response.json()).then(health => { enabled = health.onlineV2 === true; }).catch(() => {});
  window.addEventListener("pagehide", () => { const previous = client; client = undefined; previous?.close(); });
  return {
    get active() { return !!client; },
    get running() { return !!client?.prediction || !!client?.inputTimer; },
    get module() { return module(); },
    async open() { if (!client) await startShell(); wantOpen = true; canvas.focus(); },
    setVisible() {},
    showMessage: onMessage,
    close: end,
  };
}

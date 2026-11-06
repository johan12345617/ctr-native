import { OnlineV2Client } from "./online-v2-client.js";

// Extends the launcher's warm charcoal/orange controls inside the game surface.
// UI work happens on lifecycle/RTT events; gameplay ticks do not repaint the menu.
export function initRaceLobby({ canvas, getDisc, createModule, onModeRequest, onSessionChange }) {
  const $ = id => document.getElementById(id);
  let client, enabled, code = "", slot, players = [], phase = "idle", selected = false, menuOpen = true;
  let generation = 0, requestTimer;
  const tracks = Array.from($("race-track").options, option => option.textContent);
  const active = () => phase !== "idle";
  const status = message => { $("race-status").textContent = message; };
  const error = message => {
    $("race-error").hidden = !message; $("race-error").textContent = message || "";
    if (message && selected) $("race-error").scrollIntoView({ block: "nearest" });
  };

  function render() {
    const busy = phase === "requesting" || phase === "loading";
    const canEnter = enabled === true && !!getDisc() && !active();
    $("race-panel").hidden = !selected || (phase === "running" && !menuOpen);
    $("game-surface").dataset.menuOpen = String(!$("race-panel").hidden);
    $("race-disc").hidden = !!getDisc() || active();
    $("race-options").hidden = active();
    $("race-active").hidden = !code;
    $("race-cancel").hidden = !busy || !!code;
    $("race-create").disabled = $("race-join").disabled = !canEnter;
    $("race-track").disabled = $("race-code").disabled = active();
    $("race-active-code").value = code;
    $("race-start").hidden = slot !== 0 || phase === "running";
    $("race-start").disabled = phase !== "ready" || players.length !== 2 || !players.every(player => player.ready);
    $("race-resume").hidden = phase !== "running";
    $("race-menu").hidden = phase !== "running" || menuOpen;
    $("race-menu").setAttribute("aria-expanded", String(menuOpen));
    $("race-leave").textContent = slot === 0 ? "Close lobby" : "Leave lobby";
    $("race-players").replaceChildren(...Array.from({ length: 2 }, (_, index) => {
      const player = players.find(entry => entry.slot === index);
      const row = document.createElement("li");
      row.className = "border-b border-stone-700 py-2 text-stone-300";
      row.textContent = "Player " + (index + 1) + (slot === index ? " · You" : "") + " · " +
        (!player ? "Waiting to join" : player.ready ? "Ready" : "Loading game…");
      return row;
    }));
  }
  function idleHint() {
    if (enabled === undefined) status("Checking the online server…");
    else if (!enabled) status("Online races are unavailable on this server. Ask the host to enable online races, or choose Shared screen.");
    else if (!getDisc()) status("Select your game disc above to create or join a lobby.");
    else status("Create a lobby and share its code, or enter your friend's code to join.");
  }
  function endSession(message) {
    if (!active() && !client) return;
    generation++;
    clearTimeout(requestTimer);
    const previous = client; client = undefined;
    phase = "idle"; code = ""; slot = undefined; players = []; menuOpen = true;
    try { previous?.close(); } catch (failure) { console.warn("Race cleanup:", failure.message); }
    $("race-latency").hidden = true;
    onSessionChange({ active: false, running: false });
    render();
    status(message || "You left the lobby. Create or join another race.");
  }
  function handle(message, expected) {
    if (generation !== expected) return;
    if (message.type === "loading") {
      if (client.config.players !== 2) {
        endSession("This menu supports two-player races. Ask your friend to create a two-player lobby.");
        return;
      }
      clearTimeout(requestTimer);
      phase = "loading"; code = message.code; slot = message.slot;
      $("race-track-name").textContent = tracks[client.config.track];
      status("Loading your game. Share the code while your friend joins.");
      render();
    } else if (message.type === "loaded") {
      phase = "ready";
      status(slot === 0 ? "Waiting for both players to be ready." : "Waiting for the host to start the race.");
      render();
    } else if (message.type === "players") {
      players = message.players;
      if (phase === "ready") status(players.length === 2 && players.every(player => player.ready)
        ? (slot === 0 ? "Both players are ready. Start the race when you're ready." : "Both players are ready. Waiting for the host.")
        : slot === 0 ? "Share your lobby code with your friend." : "Waiting for both games to load.");
      render();
    } else if (message.type === "started") {
      phase = "running"; menuOpen = false;
      status("Race in progress. Opening the lobby releases your controls.");
      onSessionChange({ active: true, running: true });
      render();
      canvas.focus();
    } else if (message.type === "latency") {
      $("race-latency").textContent = Math.round(message.rttMs) + " ms ping";
      $("race-latency").hidden = !active();
    } else if (message.type === "error") {
      endSession("Could not enter the race. Check the code and try again.");
      error(message.message);
    } else if (message.type === "closed") {
      let reason = message.reason;
      if (/builds differ|build.*differ|versions.*differ|protocol differs/i.test(reason)) reason = "The game versions don't match. Refresh both browsers and create a new lobby.";
      else if (/diverged|synchronization/i.test(reason)) reason = "The race lost synchronization. Create a new lobby and try again.";
      else if (/initialization failed|disc assets/i.test(reason)) reason = "The game could not load. Check your NTSC-U disc and try again.";
      else if (/could not start simulation|simulation failed/i.test(reason)) reason = "The server could not load the race. Ask the host to check the game build and disc assets.";
      else if (/feasibility session disconnected|prototype connection|could not connect/i.test(reason)) reason = "Disconnected from the online server. Check your connection and try again.";
      endSession(reason);
    }
  }
  async function enter(joinCode) {
    if (active()) return;
    if (enabled !== true || !getDisc()) { idleHint(); return; }
    const expected = ++generation;
    phase = "requesting"; menuOpen = true; error();
    status(joinCode ? "Joining lobby " + joinCode + "…" : "Creating your lobby…");
    onSessionChange({ active: true, running: false });
    render();
    try {
      client = new OnlineV2Client({ createModule, disc: getDisc(), canvas, onStatus: message => handle(message, expected) });
      requestTimer = setTimeout(() => {
        if (expected === generation && phase === "requesting") {
          endSession("The lobby server did not respond. Try again.");
        }
      }, 30000);
      if (joinCode) await client.join(joinCode);
      else await client.create({ track: Number($("race-track").value), seed: crypto.getRandomValues(new Uint32Array(1))[0] });
    } catch (failure) {
      if (expected !== generation) return;
      endSession("Could not connect. Try creating or joining the lobby again.");
      error(failure.message);
    }
  }
  $("mode-race").addEventListener("click", () => {
    if (onModeRequest("race") === false) return;
    selected = true; menuOpen = true; render();
    $("game-surface").scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  });
  $("race-create-form").addEventListener("submit", event => { event.preventDefault(); void enter(); });
  $("race-join-form").addEventListener("submit", event => {
    event.preventDefault();
    const joinCode = $("race-code").value.trim().toUpperCase();
    if (!/^[A-F0-9]{6}$/.test(joinCode)) { error("Enter the six-character code from your friend (0–9 and A–F)."); return; }
    void enter(joinCode);
  });
  $("race-code").addEventListener("input", event => { event.target.value = event.target.value.toUpperCase().replace(/\s/g, ""); error(); });
  $("race-disc").addEventListener("click", () => $("disc").click());
  $("race-active-code").addEventListener("focus", event => event.target.select());
  $("race-copy").addEventListener("click", async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable.");
      await navigator.clipboard.writeText(code); status("Lobby code copied. Send it to your friend.");
    } catch {
      $("race-active-code").focus(); $("race-active-code").select();
      status("Code selected. Copy it and send it to your friend.");
    }
  });
  $("race-start").addEventListener("click", () => {
    if (!$("race-start").disabled) { $("race-start").disabled = true; client?.start(); }
  });
  $("race-leave").addEventListener("click", () => endSession(slot === 0 ? "Lobby closed. You can create another race." : "You left the lobby."));
  $("race-cancel").addEventListener("click", () => endSession("Canceled. Create or join a lobby when you're ready."));
  $("race-menu").addEventListener("click", () => {
    menuOpen = true; client?.keys.clear(); render(); $("race-resume").focus();
  });
  $("race-resume").addEventListener("click", () => { menuOpen = false; render(); canvas.focus(); });
  window.addEventListener("ctr-disc-ready", () => { if (!active()) { idleHint(); render(); } });
  window.addEventListener("pagehide", () => endSession());
  void fetch("/health", { cache: "no-store" }).then(response => {
    if (!response.ok) throw new Error("Online server unavailable.");
    return response.json();
  }).then(health => {
    enabled = health.onlineV2 === true; idleHint(); render();
  }).catch(() => { enabled = false; idleHint(); render(); });
  render();
  return {
    get active() { return active(); },
    get running() { return phase === "running"; },
    setVisible(value) { selected = value; if (value) { menuOpen = true; client?.keys.clear(); } render(); },
    showMessage(message) { menuOpen = true; status(message); render(); },
    close: endSession,
  };
}

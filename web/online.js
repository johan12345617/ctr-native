import { KEY_BUTTONS, readInput, validInput } from "./input.js";

export function initOnline(host, onRoleChange) {
  const $ = id => document.getElementById(id);
  const video = $("guest-video");
  const peers = new Map();
  const keys = new Set();
  let socket, role = null, code = "", myId, mySlot, hostId, stream, busy = false;
  let iceServers = [], players = [], sequence = 0, queue = Promise.resolve();
  const showStatus = message => { $("online-status").textContent = message; };
  function showOnline() {
    $("online-panel").hidden = false;
    $("mode-online").setAttribute("aria-expanded", "true");
    $("mode-local").setAttribute("aria-pressed", "false");
  }
  function render() {
    const active = !!code;
    $("lobby-options").hidden = active;
    $("active-lobby").hidden = !active;
    $("create-lobby").disabled = $("show-join").disabled = $("join-lobby").disabled = busy;
    $("active-code").textContent = code;
    $("host-help").hidden = role !== "host" || !active;
    $("leave-lobby").textContent = role === "host" ? "Close lobby" : "Leave lobby";
    $("invite-link").value = active ? location.origin + location.pathname + "#lobby=" + code : "";
    $("lobby-players").replaceChildren(...Array.from({ length: 4 }, (_, slot) => {
      const player = players.find(entry => entry.slot === slot);
      const row = document.createElement("li");
      row.className = "py-1 text-stone-300";
      const connected = slot === 0 || peers.get(player?.id)?.pc.connectionState === "connected" ||
        (role === "guest" && peers.get(hostId)?.pc.connectionState === "connected");
      row.textContent = "Player " + (slot + 1) + " · " + (!player ? "Open" : player.id === myId ? (slot === 0 ? "You · Host" : "You") : slot === 0 ? "Host" : connected ? "Connected" : "Connecting…");
      return row;
    }));
  }
  function send(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
  function closePeer(id) {
    const peer = peers.get(id);
    if (!peer) return;
    peers.delete(id);
    clearTimeout(peer.timeout);
    peer.pc.onconnectionstatechange = null;
    peer.channel?.close();
    peer.pc.close();
    if (role === "host") host.clearPad(peer.slot);
  }
  function reset(message, notify = true) {
    if (notify) send({ type: "leave" });
    for (const id of [...peers.keys()]) closePeer(id);
    if (stream) { host.releaseStream(stream); stream = undefined; }
    const oldSocket = socket;
    socket = undefined;
    oldSocket?.close();
    role = null; code = ""; players = []; mySlot = undefined; hostId = undefined; busy = false;
    keys.clear();
    video.pause(); video.srcObject = null; video.muted = true;
    $("guest-audio").textContent = "Enable game audio";
    $("join-form").hidden = true;
    $("show-join").setAttribute("aria-expanded", "false");
    onRoleChange(null);
    render();
    if (message) showStatus(message);
  }
  async function connect() {
    if (!window.RTCPeerConnection || !window.WebSocket) throw new Error("This browser does not support online play. Use a current desktop browser.");
    const ws = new WebSocket(location.origin.replace(/^http/, "ws") + "/lobby");
    socket = ws;
    queue = Promise.resolve();
    await new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => { reject(new Error("The lobby server did not respond. Run npm --prefix web start instead of the Python server.")); ws.close(); }, 10000);
      ws.onmessage = event => {
        if (socket !== ws) return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === "hello") {
          ready = true; clearTimeout(timer); myId = message.id; iceServers = message.iceServers; resolve(); return;
        }
        queue = queue.then(() => socket === ws && handleMessage(message)).catch(error => reset("Connection error: " + error.message + ". Leave and rejoin to try again."));
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("Cannot reach the lobby server. Run npm --prefix web start; a Python-only server cannot host lobbies.")); };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!ready) reject(new Error("The lobby server is unavailable. Use the Node lobby server and try again."));
        if (socket === ws) reset("Lobby connection lost. The host must create a new lobby, or guests can rejoin with the code.", false);
      };
    });
  }
  async function handleMessage(message) {
    if (message.type === "error") { reset(message.message); return; }
    if (message.type === "closed") { reset(message.reason, false); return; }
    if (message.type === "created" || message.type === "joined") {
      code = message.code; mySlot = message.slot; hostId = message.host;
      busy = false;
      $("join-form").hidden = true;
      if (role === "host") {
        host.setKeyboardPlayer(0);
        showStatus("Lobby ready. Share the invite link or code. You are Player 1.");
      } else {
        video.srcObject = new MediaStream();
        $("guest-audio").disabled = true;
        showStatus("Joined as Player " + (mySlot + 1) + ". Connecting to the host's screen…");
      }
      onRoleChange(role);
      render();
      return;
    }
    if (message.type === "players") { players = message.players; render(); return; }
    if (message.type === "peer-left") { closePeer(message.id); render(); return; }
    if (message.type === "peer-joined" && role === "host") {
      const peer = createPeer(message.id, message.slot);
      for (const track of stream.getTracks()) peer.pc.addTrack(track, stream);
      attachChannel(peer, peer.pc.createDataChannel("controller", { ordered: false, maxRetransmits: 0 }));
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      send({ type: "signal", target: message.id, signal: { description: peer.pc.localDescription } });
      return;
    }
    if (message.type === "signal") {
      if (role === "guest" && message.from !== hostId) return;
      const peer = peers.get(message.from) || (role === "guest" && createPeer(message.from, mySlot));
      if (!peer) return;
      const signal = message.signal;
      try {
        if (signal.description) {
          if ((role === "host" && signal.description.type !== "answer") || (role === "guest" && signal.description.type !== "offer")) return;
          await peer.pc.setRemoteDescription(signal.description);
          for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
          if (signal.description.type === "offer") {
            await peer.pc.setLocalDescription(await peer.pc.createAnswer());
            send({ type: "signal", target: peer.id, signal: { description: peer.pc.localDescription } });
          }
        } else if (signal.candidate) {
          if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate);
          else if (peer.candidates.length < 64) peer.candidates.push(signal.candidate);
        }
      } catch { connectionFailed(peer); }
    }
  }
  function createPeer(id, slot) {
    const pc = new RTCPeerConnection({ iceServers });
    const peer = { id, slot, pc, candidates: [], lastSequence: -1, channel: undefined, inputWindow: performance.now(), inputCount: 0 };
    peers.set(id, peer);
    peer.timeout = setTimeout(() => {
      if (pc.connectionState !== "connected") connectionFailed(peer);
    }, 25000);
    pc.onicecandidate = event => {
      if (event.candidate) send({ type: "signal", target: id, signal: { candidate: event.candidate.toJSON() } });
    };
    pc.onconnectionstatechange = () => {
      if (!peers.has(id)) return;
      if (pc.connectionState === "connected") {
        clearTimeout(peer.timeout);
        if (role === "guest") {
          showStatus("Connected as Player " + (mySlot + 1) + ". Click the shared screen to use your controls.");
          video.focus();
        }
      } else if (pc.connectionState === "failed") { connectionFailed(peer); }
      else if (pc.connectionState === "disconnected") {
        if (role === "host") host.clearPad(slot);
        clearTimeout(peer.timeout);
        peer.timeout = setTimeout(() => connectionFailed(peer), 10000);
        showStatus("Connection interrupted. Trying to recover…");
      }
      render();
    };
    pc.ontrack = event => {
      if (role !== "guest") return;
      if (!video.srcObject) video.srcObject = new MediaStream();
      video.srcObject.addTrack(event.track);
      if (event.track.kind === "audio") $("guest-audio").disabled = false;
      void video.play().catch(() => showStatus("Click the shared screen to start playback."));
    };
    pc.ondatachannel = event => attachChannel(peer, event.channel);
    return peer;
  }
  function connectionFailed(peer) {
    if (!peers.has(peer.id)) return;
    if (role === "host") {
      send({ type: "kick", target: peer.id });
      closePeer(peer.id);
      showStatus("A guest could not connect. They can rejoin. Internet connections may need a TURN relay configured on the server.");
      render();
    } else reset("Could not connect to the host. Rejoin the lobby. Networks with restricted NAT may need a TURN relay.");
  }
  function attachChannel(peer, channel) {
    if (channel.label !== "controller" || peer.channel) { channel.close(); return; }
    peer.channel = channel;
    channel.onopen = () => { if (role === "guest") sendInput(); };
    channel.onclose = () => { if (role === "host") host.clearPad(peer.slot); };
    channel.onerror = () => { if (role === "host") host.clearPad(peer.slot); };
    channel.onmessage = event => {
      if (role !== "host" || document.hidden || typeof event.data !== "string" || event.data.length > 256) return;
      if (performance.now() - peer.inputWindow > 1000) { peer.inputWindow = performance.now(); peer.inputCount = 0; }
      if (++peer.inputCount > 120) return;
      let packet;
      try { packet = JSON.parse(event.data); } catch { return; }
      if (!validInput(packet) || packet.seq <= peer.lastSequence) return;
      peer.lastSequence = packet.seq;
      // The sender never chooses a player slot; the lobby assigned peer.slot.
      host.setPad(peer.slot, packet.buttons, ...packet.axes);
    };
  }
  function sendInput(forceNeutral = false) {
    if (role !== "guest") return;
    const channel = peers.get(hostId)?.channel;
    if (channel?.readyState !== "open" || channel.bufferedAmount > 4096) return;
    const input = readInput(keys, navigator.getGamepads?.() || [], forceNeutral || document.hidden || !document.hasFocus() || document.activeElement !== video);
    channel.send(JSON.stringify({ type: "input", seq: sequence++, ...input }));
  }
  $("mode-online").addEventListener("click", showOnline);
  $("mode-local").addEventListener("click", () => {
    if (code || busy) { showStatus("Leave or close your lobby before returning to local play."); return; }
    $("online-panel").hidden = true;
    $("mode-online").setAttribute("aria-expanded", "false");
    $("mode-local").setAttribute("aria-pressed", "true");
  });
  $("show-join").addEventListener("click", () => {
    $("join-form").hidden = false;
    $("show-join").setAttribute("aria-expanded", "true");
    $("lobby-code").focus();
  });
  $("create-lobby").addEventListener("click", async () => {
    if (busy || code) return;
    busy = true; render(); showStatus("Preparing the host's game and stream…");
    try {
      await host.ensureRunning();
      stream = await host.captureStream();
      role = "host";
      await connect();
      send({ type: "create" });
    } catch (error) { reset(error.message); $("disc").focus(); }
  });
  $("join-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (busy || code) return;
    if (host.running) { showStatus("A game is already running in this tab. Open the invite in a new tab to join as a guest."); return; }
    const joinCode = $("lobby-code").value.trim().toUpperCase();
    if (!/^[A-F0-9]{6}$/.test(joinCode)) { showStatus("Enter the six-character lobby code from the host."); return; }
    busy = true; render(); showStatus("Joining lobby " + joinCode + "…");
    try {
      role = "guest";
      await connect();
      send({ type: "join", code: joinCode });
    } catch (error) { reset(error.message); }
  });
  $("leave-lobby").addEventListener("click", () => reset(role === "host" ? "Lobby closed. Your local game is still running." : "You left the lobby."));
  $("copy-invite").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("invite-link").value); showStatus("Invite link copied."); }
    catch { $("invite-link").focus(); $("invite-link").select(); showStatus("Select and copy the invite link above."); }
  });
  $("guest-audio").addEventListener("click", async () => {
    try {
      video.muted = !video.muted;
      await video.play();
      $("guest-audio").textContent = video.muted ? "Enable game audio" : "Mute game audio";
      video.focus();
    } catch { video.muted = true; showStatus("Audio playback was blocked. Click Enable game audio to try again."); }
  });
  video.addEventListener("click", () => { video.focus(); void video.play().catch(() => {}); });
  video.addEventListener("keydown", event => {
    if (Object.hasOwn(KEY_BUTTONS, event.code)) { event.preventDefault(); keys.add(event.code); sendInput(); }
  });
  video.addEventListener("keyup", event => {
    if (Object.hasOwn(KEY_BUTTONS, event.code)) { event.preventDefault(); keys.delete(event.code); sendInput(); }
  });
  function releaseControls() { keys.clear(); sendInput(true); }
  video.addEventListener("blur", releaseControls);
  window.addEventListener("blur", releaseControls);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      releaseControls();
      if (role === "host") for (const peer of peers.values()) host.clearPad(peer.slot);
    }
  });
  window.addEventListener("pagehide", () => reset(undefined));
  window.addEventListener("ctr-game-stopped", () => { if (role === "host") reset("The host's game stopped, so the lobby was closed."); });
  setInterval(() => {
    sendInput();
    if (role === "host" && code) host.setKeyboardPlayer(0);
  }, 33);
  const inviteCode = new URLSearchParams(location.hash.slice(1)).get("lobby");
  if (inviteCode && /^[A-Fa-f0-9]{6}$/.test(inviteCode)) {
    showOnline();
    $("join-form").hidden = false;
    $("show-join").setAttribute("aria-expanded", "true");
    $("lobby-code").value = inviteCode.toUpperCase();
    showStatus("Your invite is ready. Click Join game to connect.");
  }
  render();
}

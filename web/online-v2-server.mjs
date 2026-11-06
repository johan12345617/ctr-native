import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { SimulationWorker } from "./online-v2-simulation.mjs";
import { PROTOCOL, TICK_MS, MAX_TICK, MAX_PREDICTION_TICKS, MAX_INPUT_LEAD_TICKS, neutralPad, copyPad, validConfig, validPad, observationHash, encodeFrame } from "./online-v2-protocol.mjs";

// Opt-in feasibility coordinator. Each room owns an isolated original-game
// WASM worker. Clients send controls and diagnostic hashes, never world state.
export function createOnlineV2Coordinator({ simulationFactory = () => new SimulationWorker(),
  maxRooms = 4, maxClients = 16, autoSchedule = true, observeInput, fixture } = {}) {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const rooms = new Map();
  const clients = new Set();
  const disposals = new Set();
  let shuttingDown = false;
  let closePromise;
  const send = (client, message) => {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    if (client.socket.bufferedAmount > 262144) { client.socket.close(1008, "Client fell behind"); return; }
    client.socket.send(message.type === "frame" ? encodeFrame(message) : JSON.stringify(message));
  };
  const broadcast = (room, message) => { for (const client of room.clients) send(client, message); };
  const players = room => broadcast(room, { type: "players", players: room.clients.map(client => ({ slot: client.slot, ready: client.ready })) });
  function stop(room, reason) {
    if (room.closed) return;
    room.closed = true;
    clearTimeout(room.timer);
    rooms.delete(room.code);
    broadcast(room, { type: "closed", reason });
    for (const client of room.clients) client.room = null;
    room.dispose = Promise.resolve(room.simulation?.close());
    disposals.add(room.dispose);
    void room.dispose.then(() => disposals.delete(room.dispose), () => disposals.delete(room.dispose));
  }
  function schedule(room) {
    if (autoSchedule && !room.closed && room.running) {
      room.timer = setTimeout(() => void advance(room), Math.max(0, room.nextDeadline - performance.now()));
    }
  }
  function startRoom(room) {
    room.running = true; room.nextDeadline = performance.now() + TICK_MS;
    broadcast(room, { type: "started", tick: room.tick, tickMs: TICK_MS }); schedule(room);
  }
  async function advance(room) {
    if (room.closed || !room.running || room.stepping) return;
    room.stepping = true;
    try {
      if (room.tick >= MAX_TICK) { stop(room, "Prototype tick limit reached."); return; }
      const now = performance.now();
      const missingInputs = [];
      const pads = room.clients.map(client => {
        if (room.config.prediction) {
          const input = client.inputs.get(room.tick);
          for (const tick of client.inputs.keys()) if (tick <= room.tick) client.inputs.delete(tick);
          if (input) { client.pad = input.pad; client.inputAt = now; }
          missingInputs.push(!input);
        } else missingInputs.push(false);
        return now - client.inputAt < 250 ? copyPad(client.pad) : neutralPad();
      });
      const result = await room.simulation.request("step", { tick: room.tick, pads });
      if (room.closed) return;
      room.tick = result.tick;
      room.hashes.set(result.tick, observationHash(result.state));
      if (room.hashes.size > 120) room.hashes.delete(room.hashes.keys().next().value);
      broadcast(room, { type: "frame", ...result, pads, missingInputs });
      // Rebase a slow worker; do not burst an unlimited backlog of catch-up ticks.
      room.nextDeadline = Math.max(room.nextDeadline + TICK_MS, performance.now());
    } catch (error) { stop(room, "Simulation failed: " + error.message); }
    finally { room.stepping = false; schedule(room); }
  }
  sockets.on("connection", socket => {
    const client = { socket, room: null, slot: -1, ready: false, seq: -1,
      pad: neutralPad(), inputs: new Map(), inputAt: -Infinity, rateAt: performance.now(), count: 0, busy: false, alive: true };
    clients.add(client);
    socket.on("error", () => {});
    socket.on("pong", () => { client.alive = true; });
    send(client, { type: "hello", protocol: PROTOCOL, experimental: true });
    socket.on("message", async (bytes, binary) => {
      if (performance.now() - client.rateAt > 10000) { client.rateAt = performance.now(); client.count = 0; }
      if (binary || ++client.count > 1200) { socket.close(1008, "Invalid prototype traffic"); return; }
      let message;
      try { message = JSON.parse(bytes.toString()); }
      catch { send(client, { type: "error", message: "Invalid JSON." }); return; }
      if (!message || typeof message !== "object" || Array.isArray(message)) return;
      if (message.type === "ping" && Number.isSafeInteger(message.nonce) && message.nonce >= 0) {
        send(client, { type: "pong", nonce: message.nonce }); return;
      }
      const room = client.room;
      if (message.type === "leave") {
        if (room) stop(room, "A player left the feasibility session.");
        send(client, { type: "left" }); return;
      }
      if (message.type === "create") {
        if (room || client.busy) { send(client, { type: "error", message: "Already in a session." }); return; }
        if (!validConfig(message.config)) { send(client, { type: "error", message: "Expected protocol " + PROTOCOL + ", 2–4 players, a race track (0–17), and a uint32 seed. Prediction supports two players." }); return; }
        if (rooms.size >= maxRooms || shuttingDown) { send(client, { type: "error", message: "Prototype server is full." }); return; }
        client.busy = true;
        let code;
        do { code = randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(code));
        let created;
        try {
          created = { code, config: { protocol: PROTOCOL, players: message.config.players,
            track: message.config.track, seed: message.config.seed, prediction: message.config.prediction === true,
            ...(message.config.flow ? { flow: message.config.flow } : {}) }, clients: [client],
            simulation: message.config.flow === "menu" ? null : simulationFactory(), tick: 0, hashes: new Map(), running: false, closed: false };
          rooms.set(code, created); client.room = created; client.slot = 0; client.ready = created.config.flow === "menu"; client.seq = -1;
          client.pad = neutralPad(); client.inputAt = -Infinity; client.inputs.clear();
          if (created.config.flow === "menu") {
            send(client, { type: "lobby", code, slot: 0, config: created.config }); players(created); return;
          }
          const initial = await created.simulation.request("init", { config: created.config, ...(fixture ? { fixture } : {}) });
          if (created.closed || shuttingDown || socket.readyState !== WebSocket.OPEN) {
            stop(created, "Session closed during loading."); return;
          }
          created.initial = initial; created.tick = initial.tick;
          send(client, { type: "session", code, slot: 0, config: created.config, ...initial });
          players(created);
        } catch (error) {
          if (created) stop(created, "Could not start simulation: " + error.message);
          else send(client, { type: "error", message: error.message });
        } finally { client.busy = false; }
        return;
      }
      if (message.type === "join") {
        if (room || client.busy) { send(client, { type: "error", message: "Already in a session." }); return; }
        const code = typeof message.code === "string" ? message.code.trim().toUpperCase() : "";
        const target = /^[A-F0-9]{6}$/.test(code) ? rooms.get(code) : null;
        if (!target || target.closed || (!target.initial && target.config.flow !== "menu")) { send(client, { type: "error", message: "Session not found or still loading." }); return; }
        if (target.running || target.launchRequested || target.clients.length >= target.config.players) { send(client, { type: "error", message: "Session has started or is full." }); return; }
        client.slot = target.clients.length; client.room = target; client.ready = target.config.flow === "menu"; client.seq = -1;
        client.pad = neutralPad(); client.inputAt = -Infinity; client.inputs.clear();
        target.clients.push(client);
        send(client, { type: target.config.flow === "menu" ? "lobby" : "session", code, slot: client.slot, config: target.config, ...target.initial });
        players(target); return;
      }
      if (!room || room.closed) { send(client, { type: "error", message: "Join a feasibility session first." }); return; }
      if (message.type === "ready") {
        if (room.running) return;
        if (!room.initial) { send(client, { type: "error", message: "The authority is still loading." }); return; }
        if (message.build !== room.initial.build || message.tick !== room.initial.tick ||
          message.hash !== observationHash(room.initial.state)) {
          stop(room, "Initial simulation diverged or builds differ. Record this feasibility failure."); return;
        }
        client.ready = true; players(room);
        if (room.launchRequested && room.clients.length === room.config.players && room.clients.every(peer => peer.ready)) startRoom(room);
        return;
      }
      if (message.type === "start") {
        if (client.slot !== 0 || room.running || room.launchRequested || room.clients.length !== room.config.players || !room.clients.every(peer => peer.ready)) {
          send(client, { type: "error", message: "Only Player 1 can start, after every player has loaded and matched the initial state." }); return;
        }
        if (room.config.flow === "menu") {
          room.launchRequested = true;
          for (const peer of room.clients) peer.ready = false;
          broadcast(room, { type: "booting" }); players(room);
          try {
            room.simulation = simulationFactory();
            const initial = await room.simulation.request("init", { config: room.config, ...(fixture ? { fixture } : {}) });
            if (room.closed) return;
            room.initial = initial; room.tick = initial.tick;
            for (const peer of room.clients) send(peer, { type: "session", code: room.code, slot: peer.slot, config: room.config, ...initial });
          } catch (error) { stop(room, "Could not start simulation: " + error.message); }
          return;
        }
        startRoom(room); return;
      }
      if (message.type === "input") {
        if (!room.running || !validPad(message) || !Number.isSafeInteger(message.seq) || message.seq <= client.seq ||
          !Number.isInteger(message.tick) || message.tick > MAX_TICK || message.tick > room.tick + MAX_INPUT_LEAD_TICKS) {
          observeInput?.({ status: "invalid", slot: client.slot, tick: message.tick, authorityTick: room.tick, seq: message.seq, previousSeq: client.seq });
          return;
        }
        if (room.config.prediction) {
          // A control belongs to exactly one future authority tick. Inputs for
          // an in-flight or completed tick cannot rewrite history or spill into
          // an unrelated frame when delayed packets finally arrive.
          if (message.tick < room.tick + (room.stepping ? 1 : 0)) {
            observeInput?.({ status: "late", slot: client.slot, tick: message.tick, authorityTick: room.tick, inFlight: room.stepping });
            return;
          }
          client.seq = message.seq;
          client.inputs.set(message.tick, { pad: copyPad(message) });
          observeInput?.({ status: "queued", slot: client.slot, tick: message.tick, authorityTick: room.tick });
          return;
        }
        if (message.tick < room.tick - MAX_PREDICTION_TICKS) return;
        // Slot ownership comes exclusively from the socket's room membership.
        client.seq = message.seq; client.pad = { buttons: message.buttons, axes: [...message.axes] };
        client.inputAt = performance.now(); return;
      }
      if (message.type === "report") {
        if (!room.running || !Number.isInteger(message.tick) || !room.hashes.has(message.tick)) return;
        if (message.hash !== room.hashes.get(message.tick)) {
          stop(room, "Simulation diverged at tick " + message.tick + " for Player " + (client.slot + 1) + ".");
        }
      }
    });
    socket.on("close", () => {
      clients.delete(client);
      if (client.room) stop(client.room, "A player disconnected from the feasibility session.");
    });
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.alive) client.socket.terminate();
      else { client.alive = false; client.socket.ping(); }
    }
  }, 15000);
  heartbeat.unref();
  return {
    handleUpgrade(request, socket, head) {
      if (shuttingDown || clients.size >= maxClients) { socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n"); return; }
      sockets.handleUpgrade(request, socket, head, ws => sockets.emit("connection", ws));
    },
    // Explicit advancement makes transport/lifecycle tests independent of timers.
    advance: code => { const room = rooms.get(code); return room ? advance(room) : Promise.resolve(); },
    close() {
      if (closePromise) return closePromise;
      shuttingDown = true; clearInterval(heartbeat);
      const active = [...rooms.values()];
      for (const room of active) stop(room, "Prototype server stopped.");
      for (const client of clients) client.socket.terminate();
      sockets.close();
      closePromise = Promise.all([...disposals]).then(() => undefined);
      return closePromise;
    },
  };
}

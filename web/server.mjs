import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { createOnlineV2Coordinator } from "./online-v2-server.mjs";

const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ...["index.html", "app.js", "online.js", "input.js", "online-v2-client.js", "online-v2-runtime.mjs", "online-v2-protocol.mjs", "online-v2-prediction.mjs", "online-v2-latency.mjs", "online-v2-lobby.js", "online-v2-engine.js", "styles.css", "ctr_native.js", "ctr_native.wasm"].map(file =>
    ["/" + file, [file, file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html; charset=utf-8" : "text/javascript"]]),
]);

export function createLobbyServer({
  root = fileURLToPath(new URL("../build-web/", import.meta.url)),
  iceServers = [{ urls: "stun:stun.l.google.com:19302" }],
  publicOrigin,
  maxRooms = 128,
  maxClients = 512,
  onlineV2 = false,
  localDisc = fileURLToPath(new URL("../assets/ctr-u.bin", import.meta.url)),
} = {}) {
  const rooms = new Map();
  const clients = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end(); return;
    }
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/local-disc") {
      // Explicit development convenience: only this disc, only the local
      // machine. Remote players still select their own disc in the browser.
      const peer = request.socket.remoteAddress;
      let localHost = false;
      try { localHost = ["localhost", "127.0.0.1", "[::1]"].includes(new URL("http://" + request.headers.host).hostname); } catch {}
      if (!localDisc || !localHost || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer) ||
          (request.headers.origin && request.headers.origin !== "http://" + request.headers.host)) {
        response.writeHead(404).end("Not found"); return;
      }
      try {
        const file = await stat(localDisc);
        response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": file.size,
          "Cache-Control": "private, no-store", "Cross-Origin-Resource-Policy": "same-origin" });
        if (request.method === "HEAD") response.end();
        else {
          const stream = createReadStream(localDisc);
          response.once("close", () => stream.destroy());
          stream.on("error", () => response.destroy()).pipe(response);
        }
      } catch { response.writeHead(404).end("Local disc unavailable"); }
      return;
    }
    if (pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
        .end(JSON.stringify({ ok: true, onlineV2: !!prototype })); return;
    }
    const entry = publicFiles.get(pathname);
    if (!entry) { response.writeHead(404).end("Not found"); return; }
    try {
      const bytes = await readFile(resolve(root, entry[0]));
      response.writeHead(200, { "Content-Type": entry[1], "Cache-Control": "no-cache" });
      response.end(request.method === "HEAD" ? undefined : bytes);
    } catch {
      response.writeHead(404).end("Web build missing. Run build-web.ps1 or build-web.sh first.");
    }
  });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const prototype = onlineV2 ? createOnlineV2Coordinator(onlineV2 === true ? {} : onlineV2) : null;
  const send = (client, data) => {
    if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(data));
  };
  function broadcastRoom(room) {
    const players = [{ id: room.host.id, slot: 0 }, ...[...room.guests.values()].map(client => ({ id: client.id, slot: client.slot }))];
    for (const client of [room.host, ...room.guests.values()]) send(client, { type: "players", players });
  }
  function leave(client) {
    const room = rooms.get(client.code);
    client.code = null;
    if (!room) return;
    if (room.host === client) {
      rooms.delete(room.code);
      for (const guest of room.guests.values()) {
        guest.code = null;
        send(guest, { type: "closed", reason: "The host closed the lobby." });
      }
    } else {
      room.guests.delete(client.id);
      send(room.host, { type: "peer-left", id: client.id, slot: client.slot });
      broadcastRoom(room);
    }
  }
  server.on("upgrade", (request, socket, head) => {
    const origin = request.headers.origin;
    let allowed = !origin;
    try { allowed ||= origin === publicOrigin || new URL(origin).host === request.headers.host; } catch {}
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/online-v2" && allowed && prototype) {
      prototype.handleUpgrade(request, socket, head); return;
    }
    if (pathname !== "/lobby" || !allowed || clients.size >= maxClients) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit("connection", ws));
  });
  sockets.on("connection", socket => {
    const client = { socket, id: randomUUID(), code: null, slot: 0, alive: true, rateStart: Date.now(), count: 0 };
    clients.set(client.id, client);
    socket.on("error", () => {});
    socket.on("pong", () => { client.alive = true; });
    send(client, { type: "hello", id: client.id, iceServers });
    socket.on("message", (bytes, binary) => {
      if (Date.now() - client.rateStart > 10000) { client.rateStart = Date.now(); client.count = 0; }
      if (++client.count > 200 || binary) { socket.close(1008, "Invalid signaling traffic"); return; }
      let message;
      try { message = JSON.parse(bytes.toString()); } catch { send(client, { type: "error", message: "Invalid message." }); return; }
      if (!message || typeof message !== "object") return;
      if (message.type === "leave") { leave(client); send(client, { type: "left" }); return; }
      if (message.type === "create" || message.type === "join") {
        if (client.code) { send(client, { type: "error", message: "Leave your current lobby first." }); return; }
        if (message.type === "create") {
          if (rooms.size >= maxRooms) { send(client, { type: "error", message: "The lobby server is full. Try again later." }); return; }
          let code;
          do { code = randomBytes(4).toString("hex").slice(0, 6).toUpperCase(); } while (rooms.has(code));
          client.code = code;
          client.slot = 0;
          const room = { code, host: client, guests: new Map() };
          rooms.set(code, room);
          send(client, { type: "created", code, slot: 0 });
          broadcastRoom(room);
        } else {
          const code = typeof message.code === "string" ? message.code.trim().toUpperCase() : "";
          const room = /^[A-F0-9]{6}$/.test(code) ? rooms.get(code) : null;
          if (!room) { send(client, { type: "error", message: "Lobby not found. Check the code and make sure the host is still online." }); return; }
          const occupied = new Set([...room.guests.values()].map(guest => guest.slot));
          const slot = [1, 2, 3].find(candidate => !occupied.has(candidate));
          if (!slot) { send(client, { type: "error", message: "This lobby is full (4 players)." }); return; }
          client.code = code;
          client.slot = slot;
          room.guests.set(client.id, client);
          send(client, { type: "joined", code, slot, host: room.host.id });
          send(room.host, { type: "peer-joined", id: client.id, slot });
          broadcastRoom(room);
        }
        return;
      }
      if (message.type === "signal") {
        const room = rooms.get(client.code);
        const target = clients.get(message.target);
        if (!room || !target || target.code !== client.code || target === client ||
            (room.host !== client && room.host !== target)) return;
        const signal = message.signal;
        if (!signal || typeof signal !== "object") return;
        if (signal.description && (!["offer", "answer"].includes(signal.description.type) || typeof signal.description.sdp !== "string")) return;
        if (!signal.description && !signal.candidate) return;
        send(target, { type: "signal", from: client.id, signal });
      }
      if (message.type === "kick") {
        const room = rooms.get(client.code);
        const guest = room?.guests.get(message.target);
        if (room?.host === client && guest) {
          leave(guest);
          send(guest, { type: "closed", reason: "The connection to the host failed. Rejoin the lobby to try again." });
        }
      }
    });
    socket.on("close", () => { leave(client); clients.delete(client.id); });
  });
  const heartbeat = setInterval(() => {
    for (const client of clients.values()) {
      if (!client.alive) { client.socket.terminate(); continue; }
      client.alive = false;
      client.socket.ping();
    }
  }, 15000);
  heartbeat.unref();
  server.on("close", () => { clearInterval(heartbeat); sockets.close(); void prototype?.close(); });
  return {
    server,
    prototype,
    close: () => new Promise(resolveClose => {
      clearInterval(heartbeat);
      for (const client of clients.values()) client.socket.terminate();
      const stopped = prototype?.close();
      server.close(() => Promise.resolve(stopped).then(resolveClose));
      server.closeAllConnections();
    }),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let iceServers;
  try { iceServers = process.env.CTR_ICE_SERVERS ? JSON.parse(process.env.CTR_ICE_SERVERS) : undefined; }
  catch { console.error("CTR_ICE_SERVERS must contain a JSON array of RTCIceServer entries."); process.exit(1); }
  if (iceServers !== undefined && !Array.isArray(iceServers)) { console.error("CTR_ICE_SERVERS must be an array."); process.exit(1); }
  const { server } = createLobbyServer({ iceServers, publicOrigin: process.env.PUBLIC_ORIGIN,
    onlineV2: process.env.CTR_ONLINE_V2 === "1" || process.argv.includes("--online-v2") });
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || "127.0.0.1";
  server.on("error", error => {
    console.error(error.code === "EADDRINUSE" ? "Port " + port + " is in use. Stop the Python server or set PORT to another port." : error.message);
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log("CTR lobby server: http://" + host + ":" + port));
}

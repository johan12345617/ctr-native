import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createLobbyServer } from "../server.mjs";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture(t) {
  const app = createLobbyServer({ iceServers: [] });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const address = "http://127.0.0.1:" + app.server.address().port;
  const all = [];
  t.after(async () => { for (const client of all) client.socket.terminate(); await app.close(); });
  async function connect() {
    const socket = new WebSocket(address.replace("http", "ws") + "/lobby");
    const messages = [];
    const waiters = [];
    socket.on("error", () => {});
    socket.on("message", bytes => {
      const message = JSON.parse(bytes);
      const index = waiters.findIndex(waiter => waiter.type === message.type);
      if (index !== -1) waiters.splice(index, 1)[0].resolve(message);
      else messages.push(message);
    });
    const client = {
      socket, messages,
      send: message => socket.send(JSON.stringify(message)),
      next(type) {
        const index = messages.findIndex(message => message.type === type);
        if (index !== -1) return Promise.resolve(messages.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timed out waiting for " + type)), 2000);
          waiters.push({ type, resolve: value => { clearTimeout(timer); resolve(value); } });
        });
      },
    };
    all.push(client);
    client.id = (await client.next("hello")).id;
    return client;
  }
  return { address, connect };
}

test("automatic disc loading streams only the configured file on loopback", async t => {
  const directory = await mkdtemp(join(tmpdir(), "ctr-disc-"));
  const disc = join(directory, "ctr-u.bin"); await writeFile(disc, "private-test-disc");
  const app = createLobbyServer({ iceServers: [], localDisc: disc });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await app.close(); await unlink(disc); await rmdir(directory); });
  const url = "http://127.0.0.1:" + app.server.address().port + "/local-disc";
  const file = await fetch(url);
  assert.equal(await file.text(), "private-test-disc");
  assert.equal(file.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.equal(file.headers.get("cache-control"), "private, no-store");
  assert.equal((await fetch(url, { method: "HEAD" })).headers.get("content-length"), "17");
  assert.equal((await fetch(url, { headers: { Origin: "https://another-site.example" } })).status, 404);
  const rebound = await new Promise((resolve, reject) => {
    request(url, { headers: { Host: "another-site.example" } }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject).end();
  });
  assert.equal(rebound, 404);
  assert.equal((await fetch(url + "/../assets/ctr-u.bin")).status, 404);
});

test("lobbies assign unique slots, reject overflow and reuse released slots", async t => {
  const { connect } = await fixture(t);
  const host = await connect();
  host.send({ type: "create" });
  const { code } = await host.next("created");
  assert.match(code, /^[A-F0-9]{6}$/);
  const guests = [];
  for (let slot = 1; slot <= 3; slot++) {
    const guest = await connect();
    guest.send({ type: "join", code: code.toLowerCase() });
    assert.equal((await guest.next("joined")).slot, slot);
    assert.equal((await host.next("peer-joined")).slot, slot);
    guests.push(guest);
  }
  const extra = await connect();
  extra.send({ type: "join", code });
  assert.match((await extra.next("error")).message, /full/);
  guests[1].send({ type: "leave" });
  await guests[1].next("left");
  assert.equal((await host.next("peer-left")).slot, 2);
  extra.send({ type: "join", code });
  assert.equal((await extra.next("joined")).slot, 2);
  host.send({ type: "leave" });
  await host.next("left");
  assert.match((await extra.next("closed")).reason, /host closed/);
  guests[1].send({ type: "join", code });
  assert.match((await guests[1].next("error")).message, /not found/);
});

test("signaling is limited to the host and guests of the same lobby", async t => {
  const { connect } = await fixture(t);
  const host = await connect(), guest = await connect(), outsider = await connect();
  host.send({ type: "create" });
  const { code } = await host.next("created");
  guest.send({ type: "join", code });
  await guest.next("joined");
  await host.next("peer-joined");
  const signal = { description: { type: "offer", sdp: "example-sdp" } };
  host.send({ type: "signal", target: outsider.id, signal });
  host.send({ type: "signal", target: guest.id, signal });
  const forwarded = await guest.next("signal");
  assert.equal(forwarded.from, host.id);
  assert.deepEqual(forwarded.signal, signal);
  assert.equal(outsider.messages.some(message => message.type === "signal"), false);
  guest.send({ type: "kick", target: host.id });
  host.send({ type: "kick", target: guest.id });
  assert.match((await guest.next("closed")).reason, /connection/);
});

test("unknown rooms and malformed requests fail without killing the server", async t => {
  const { connect, address } = await fixture(t);
  const guest = await connect();
  guest.socket.send("{");
  assert.match((await guest.next("error")).message, /Invalid/);
  guest.send({ type: "join", code: "000000" });
  assert.match((await guest.next("error")).message, /not found/);
  const health = await fetch(address + "/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, onlineV2: false });
  for (const path of ["/assets/ctr-u.bin", "/CMakeCache.txt", "/.git/config", "/server.mjs"]) {
    assert.equal((await fetch(address + path)).status, 404);
  }
  assert.equal((await fetch(address, { method: "POST" })).status, 405);
});

test("cross-origin WebSocket connections are rejected", { timeout: 5000 }, async t => {
  const { address } = await fixture(t);
  const socket = new WebSocket(address.replace("http", "ws") + "/lobby", { origin: "https://another-site.example" });
  socket.on("error", () => {});
  await new Promise((resolve, reject) => {
    socket.on("open", () => reject(new Error("Cross-origin connection was accepted")));
    socket.on("unexpected-response", (_, response) => { assert.equal(response.statusCode, 403); response.resume(); socket.terminate(); resolve(); });
  });
});

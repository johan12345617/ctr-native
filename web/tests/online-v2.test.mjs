import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { createLobbyServer } from "../server.mjs";
import { OBSERVATION_BYTES, PROTOCOL, MAX_INPUT_LEAD_TICKS, validConfig, validPad, neutralPad, observationHash, firstDifference, decodeFrame, encodeFrame } from "../online-v2-protocol.mjs";
import { LatencyEstimator } from "../online-v2-latency.mjs";
import { SimulationRuntime } from "../online-v2-runtime.mjs";
import { OnlineV2Client } from "../online-v2-client.js";

const config = { protocol: PROTOCOL, players: 2, track: 0, seed: 12345 };
const state = Array(OBSERVATION_BYTES).fill(0);

test("confirmed menus send a bounded input stream even with an eight-tick latency lead", () => {
  const sent = [];
  const client = { simulation: { tick: 20 }, latency: { inputLead: 8 }, seq: 0, send(message) { sent.push(message); } };
  for (let tick = 20; tick < 620; tick++) {
    client.simulation.tick = tick;
    const pad = { ...neutralPad(), buttons: tick % 80 < 40 ? 0 : 0x4000 };
    OnlineV2Client.prototype.sendMenuInput.call(client, pad);
    OnlineV2Client.prototype.sendMenuInput.call(client, pad);
  }
  assert.equal(sent.length, 600);
  assert.equal(sent[0].tick, 27); assert.equal(sent.at(-1).tick, 626);
});

test("slow menu scheduling preserves quick press/release edges in a single confirmation tick", () => {
  const sent = [];
  const client = { simulation: { tick: 20 }, latency: { inputLead: 16 }, seq: 0, send(message) { sent.push(message); } };
  for (const buttons of [0, 0x4000, 0, 0]) OnlineV2Client.prototype.sendMenuInput.call(client, { ...neutralPad(), buttons });
  assert.deepEqual(sent.map(({ tick, buttons }) => [tick, buttons]), [[35, 0], [36, 0x4000], [37, 0]]);
});

test("race controls reach future authority ticks without growing the prediction window", () => {
  const sent = [];
  const client = Object.assign(Object.create(OnlineV2Client.prototype), {
    latency: { inputLead: 14 }, prediction: { maxPredictionTicks: 8 }, seq: 0, send(message) { sent.push(message); },
  });
  const applied = [];
  for (let tick = 20; tick < 34; tick++) {
    applied.push(client.sendRacingInput(tick, { ...neutralPad(), buttons: tick === 20 ? 0x4000 : 0 }).buttons);
  }
  assert.equal(sent[0].tick, 26);
  assert.deepEqual(applied.slice(0, 8), [0, 0, 0, 0, 0, 0, 0x4000, 0]);
  assert.equal(client.prediction.maxPredictionTicks, 8);
  assert.ok(client.scheduledInputs.size <= 6);
  client.latency.inputLead = 3;
  assert.equal(client.sendRacingInput(34, { ...neutralPad(), buttons: 0x20 }).buttons, 0x20);
  assert.equal(sent.at(-1).tick, 34, "Short RTT controls must still be immediate.");
});

test("binary authority frames preserve controls, state and missing-input ownership at bounded size", () => {
  for (const players of [2, 4]) {
    const frame = { tick: 9876, milliseconds: 1.25,
      pads: Array.from({ length: players }, (_, slot) => ({ buttons: 65535 - slot, axes: [0, 255, slot, 128] })),
      missingInputs: Array.from({ length: players }, (_, slot) => slot % 2 === 0), state: Uint8Array.from(state, (_, i) => i % 256) };
    const encoded = encodeFrame(frame);
    assert.equal(encoded.length, 24 + 6 * players + OBSERVATION_BYTES);
    // ws Buffer views can start at a nonzero byte offset.
    const envelope = Buffer.alloc(encoded.length + 17); envelope.set(encoded, 7);
    const decoded = decodeFrame(envelope.subarray(7, 7 + encoded.length));
    assert.deepEqual(decoded, { type: "frame", ...frame });
    assert.deepEqual(decodeFrame(encoded.buffer), decoded);
    for (const cut of [0, 23, encoded.length - 1]) assert.throws(() => decodeFrame(encoded.subarray(0, cut)));
    for (const [offset, value] of [[0, 0], [12, 1], [13, 255], [14, PROTOCOL + 1], [16, 0], [20, 1]]) {
      const bad = encoded.slice(); bad[offset] = value; assert.throws(() => decodeFrame(bad));
    }
    for (const cost of [-1, NaN, Infinity, Number.MAX_VALUE]) assert.throws(() => encodeFrame({ ...frame, milliseconds: cost }));
    assert.throws(() => encodeFrame({ ...frame, missingInputs: [true] }));
  }
});

test("RTT estimator uses jitter margin while bounding local prediction memory and latency", () => {
  const latency = new LatencyEstimator();
  assert.equal(latency.predictionLead, 2);
  assert.equal(latency.inputLead, 2);
  for (let i = 0; i < 20; i++) latency.record(5);
  assert.equal(latency.predictionLead, 2);
  for (let i = 0; i < 100; i++) latency.record(120);
  assert.equal(latency.predictionLead, 5);
  latency.record(240);
  assert.ok(latency.jitterMs > 20);
  assert.ok(latency.predictionLead >= 7);
  latency.record(9000); assert.equal(latency.predictionLead, 8);
  assert.equal(latency.inputLead, MAX_INPUT_LEAD_TICKS);
  const before = { ...latency };
  for (const invalid of [-1, NaN, Infinity, 10001]) assert.equal(latency.record(invalid), false);
  assert.deepEqual({ ...latency }, before);
});

test("a tunnel RTT can exceed eight ticks without capping network input scheduling", () => {
  const latency = new LatencyEstimator(); latency.record(420);
  assert.equal(latency.predictionLead, 8);
  assert.equal(latency.inputLead, 14);
});

async function fixture(t, options = {}) {
  const simulations = [];
  const simulationFactory = () => {
    const simulation = {
      tick: 10, closed: false, calls: [],
      async request(type, args) {
        this.calls.push({ type, ...args });
        if (type === "init") return { tick: 10, state, build: "test-build" };
        if (type === "step") return { tick: ++this.tick, state, milliseconds: 1 };
        throw new Error("Unexpected command.");
      },
      async close() { this.closed = true; },
    };
    simulations.push(simulation); return simulation;
  };
  const app = createLobbyServer({ iceServers: [], onlineV2: { simulationFactory, autoSchedule: false, ...options } });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  const address = "ws://127.0.0.1:" + app.server.address().port + "/online-v2";
  const all = [];
  t.after(async () => { for (const client of all) client.socket.terminate(); await app.close(); });
  async function connect() {
    const socket = new WebSocket(address);
    const queued = [], pending = [];
    socket.on("error", () => {});
    socket.on("message", (bytes, binary) => {
      const message = binary ? decodeFrame(bytes) : JSON.parse(bytes);
      const index = pending.findIndex(waiter => waiter.type === message.type);
      if (index >= 0) pending.splice(index, 1)[0].resolve(message);
      else queued.push(message);
    });
    const client = {
      socket,
      send(message) { socket.send(JSON.stringify(message)); },
      next(type) {
        const index = queued.findIndex(message => message.type === type);
        if (index >= 0) return Promise.resolve(queued.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timeout: " + type)), 3000);
          pending.push({ type, resolve: message => { clearTimeout(timer); resolve(message); } });
        });
      },
    };
    all.push(client); assert.equal((await client.next("hello")).protocol, PROTOCOL); return client;
  }
  async function session(sessionConfig = config) {
    const host = await connect(), guest = await connect();
    host.send({ type: "create", config: sessionConfig });
    const initial = await host.next("session");
    guest.send({ type: "join", code: initial.code.toLowerCase() });
    assert.equal((await guest.next("session")).slot, 1);
    const ready = { type: "ready", tick: 10, hash: observationHash(state), build: "test-build" };
    host.send(ready); guest.send(ready);
    // Barrier: a response from each socket confirms its ready message was handled.
    host.send({ type: "join", code: initial.code }); await host.next("error");
    guest.send({ type: "join", code: initial.code }); await guest.next("error");
    return { host, guest, code: initial.code };
  }
  return { app, connect, session, simulations, address };
}

test("prototype protocol rejects unsupported human counts, modes and malformed controls", () => {
  assert.equal(validConfig(config), true);
  assert.equal(validConfig({ ...config, flow: "menu", prediction: true }), true);
  for (const value of [null, {}, { ...config, players: 8 }, { ...config, players: 1 },
    { ...config, protocol: PROTOCOL + 1 }, { ...config, track: 18 }, { ...config, seed: -1 }, { ...config, seed: 2 ** 32 },
    { ...config, prediction: "yes" }, { ...config, players: 4, prediction: true },
    { ...config, flow: "adventure" }, { ...config, flow: "menu", players: 4 }]) {
    assert.equal(validConfig(value), false);
  }
  assert.equal(validPad(neutralPad()), true);
  for (const value of [null, {}, { buttons: -1, axes: [128, 128, 128, 128] },
    { buttons: 0, axes: [0, 0, 0, 256] }, { buttons: 65536, axes: [0, 0, 0, 0] }]) assert.equal(validPad(value), false);
  assert.equal(firstDifference([0, 1], [0, 2]), 1);
  assert.equal(firstDifference([0], [0]), -1);
});

test("engine lobbies wait without a simulation and start only after both engines match", async t => {
  const { connect, simulations } = await fixture(t);
  const host = await connect(), guest = await connect();
  host.send({ type: "create", config: { ...config, flow: "menu", prediction: true } });
  const lobby = await host.next("lobby");
  assert.equal(simulations.length, 0);
  guest.send({ type: "join", code: lobby.code });
  assert.equal((await guest.next("lobby")).slot, 1);
  guest.send({ type: "start" }); assert.match((await guest.next("error")).message, /Player 1/);
  host.send({ type: "start" });
  await host.next("booting"); await guest.next("booting");
  const initial = await host.next("session"); await guest.next("session");
  assert.equal(initial.config.flow, "menu");
  assert.equal(simulations.length, 1);
  const ready = { type: "ready", tick: initial.tick, hash: observationHash(initial.state), build: initial.build };
  host.send(ready); guest.send(ready);
  await host.next("started"); await guest.next("started");
  host.send({ type: "leave" }); await guest.next("closed");
  assert.equal(simulations[0].closed, true);
});

test("canceling an engine lobby before start allocates no game worker", async t => {
  const { connect, simulations } = await fixture(t);
  const host = await connect();
  host.send({ type: "create", config: { ...config, flow: "menu" } }); await host.next("lobby");
  host.send({ type: "leave" }); await host.next("closed");
  assert.equal(simulations.length, 0);
});

test("authority owns controls and ticks; duplicates and client world state cannot change authority", async t => {
  const { session, app, simulations } = await fixture(t);
  const { host, guest, code } = await session();
  guest.send({ type: "start" }); assert.match((await guest.next("error")).message, /Player 1/);
  host.send({ type: "start" }); await host.next("started"); await guest.next("started");
  guest.send({ type: "input", tick: 10, seq: 1, slot: 0, buttons: 0x4000, axes: [128, 128, 255, 128], state: [999] });
  guest.send({ type: "input", tick: 10, seq: 0, buttons: 0x8000, axes: [0, 0, 0, 0] });
  guest.send({ type: "input", tick: 9999, seq: 2, buttons: 0x8000, axes: [0, 0, 0, 0] });
  guest.send({ type: "join", code }); await guest.next("error");
  await app.prototype.advance(code);
  const frame = await host.next("frame");
  assert.equal(frame.tick, 11);
  assert.deepEqual(frame.pads[0], neutralPad());
  assert.equal(frame.pads[1].buttons, 0x4000);
  assert.deepEqual(simulations[0].calls.at(-1), { type: "step", tick: 10, pads: frame.pads });
  host.send({ type: "report", tick: 9999, hash: "forged" });
  host.send({ type: "report", tick: 11, hash: observationHash(state) });
  guest.send({ type: "report", tick: 11, hash: "diverged" });
  assert.match((await host.next("closed")).reason, /tick 11.*Player 2/);
  assert.equal(simulations[0].closed, true);
});

test("application ping works before loading and client fixtures cannot enter the simulation", async t => {
  const { connect, simulations } = await fixture(t);
  const host = await connect();
  host.send({ type: "ping", nonce: 27 });
  assert.deepEqual(await host.next("pong"), { type: "pong", nonce: 27 });
  host.send({ type: "create", config: { ...config, fixture: { scenario: 7, juiced: 1 } }, fixture: { scenario: 8, juiced: 1 } });
  const initial = await host.next("session");
  assert.equal(initial.fixture, undefined);
  assert.deepEqual(simulations[0].calls[0], { type: "init", config: { ...config, prediction: false } });
});

test("health advertises online race availability to the launcher", async t => {
  const { address } = await fixture(t);
  const response = await fetch(address.replace(/^ws/, "http").replace(/online-v2$/, "health"));
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true, onlineV2: true });
});

test("start requires every slot, matching build and matching initial observation", async t => {
  const { connect, simulations } = await fixture(t);
  const host = await connect(); host.send({ type: "create", config }); await host.next("session");
  host.send({ type: "start" }); assert.match((await host.next("error")).message, /every player/);
  host.send({ type: "ready", tick: 10, hash: observationHash(state), build: "different-build" });
  assert.match((await host.next("closed")).reason, /builds differ/);
  assert.equal(simulations[0].closed, true);
});

test("stale controls become neutral and disconnect stops the isolated match", async t => {
  const { session, app, simulations } = await fixture(t);
  const { host, guest, code } = await session();
  host.send({ type: "start" }); await host.next("started");
  host.send({ type: "input", tick: 10, seq: 0, ...neutralPad(), buttons: 0x4000 });
  host.send({ type: "join", code }); await host.next("error");
  await delay(280);
  await app.prototype.advance(code);
  assert.deepEqual((await host.next("frame")).pads[0], neutralPad());
  guest.socket.close();
  assert.match((await host.next("closed")).reason, /disconnected/);
  assert.equal(simulations[0].closed, true);
});

test("room capacity, malformed requests and eight-human configuration fail safely", async t => {
  const { connect } = await fixture(t, { maxRooms: 1 });
  const host = await connect(), extra = await connect();
  host.socket.send("{"); assert.match((await host.next("error")).message, /JSON/);
  host.send({ type: "create", config: { ...config, players: 8 } }); assert.match((await host.next("error")).message, /2–4/);
  host.send({ type: "create", config }); const { code } = await host.next("session");
  extra.send({ type: "create", config }); assert.match((await extra.next("error")).message, /full/);
  extra.send({ type: "join", code: "missing" }); assert.match((await extra.next("error")).message, /not found/);
  extra.send({ type: "join", code }); await extra.next("session");
  const third = await connect(); third.send({ type: "join", code }); assert.match((await third.next("error")).message, /full/);
  extra.send({ type: "leave" }); assert.match((await host.next("closed")).reason, /left/);
});

test("runtime rejects reordered ticks before mutating controls", () => {
  const calls = [];
  const module = {
    HEAPU8: new Uint8Array(2048), _CTR_OnlineConfigure: () => 1, _malloc: () => 64,
    callMain: () => 0, _CTR_OnlineBuild: () => 0, _CTR_OnlineTick: () => 10,
    _CTR_OnlineSetPad: (...args) => { calls.push(args); return 1; }, _CTR_OnlineStep: () => 1,
    _CTR_OnlineObserve: () => OBSERVATION_BYTES,
  };
  const simulation = new SimulationRuntime(module, config);
  assert.throws(() => simulation.step([neutralPad(), neutralPad()], 9), /Out-of-order/);
  assert.equal(calls.length, 0);
  assert.throws(() => simulation.step([neutralPad()], 10), /Invalid/);
  assert.equal(calls.length, 0);
  for (const slot of [-1, 1.5, 10, NaN]) assert.throws(() => simulation.save(slot), /Invalid checkpoint/);
  assert.throws(() => simulation.restore(1, undefined), /Invalid checkpoint/);
  assert.throws(() => simulation.restore(1, -1), /Invalid checkpoint/);
  assert.throws(() => simulation.setupFixture({ scenario: 7, juiced: 1 }), /Private power-up fixture/);
  assert.equal(calls.length, 0);
});

test("runtime surfaces asset initialization errors before stepping", () => {
  let freed = false;
  const module = { _CTR_OnlineConfigure: () => 1, _malloc: () => 64,
    callMain: () => 1, _free: () => { freed = true; } };
  assert.throws(() => new SimulationRuntime(module, config), /initialization failed/);
  assert.equal(freed, true);
});

test("local camera identity is installed before boot and never changes the match configuration", () => {
  const calls = [];
  const module = {
    HEAPU8: new Uint8Array(2048),
    _CTR_OnlineConfigure: (...args) => { calls.push(["configure", ...args]); return 1; },
    _CTR_OnlineSetLocalPlayer: slot => { calls.push(["view", slot]); return 1; },
    _malloc: () => 64, _CTR_OnlineBuild: () => 0,
    callMain: () => { calls.push(["boot"]); return 0; },
  };
  new SimulationRuntime(module, config, { localPlayer: 1 });
  assert.deepEqual(calls, [["configure", 2, 0, 12345], ["view", 1], ["boot"]]);
  calls.length = 0;
  new SimulationRuntime(module, config); // Authority has no local camera.
  assert.deepEqual(calls, [["configure", 2, 0, 12345], ["boot"]]);
  for (const localPlayer of [-1, 2, 0.5, NaN]) {
    calls.length = 0;
    assert.throws(() => new SimulationRuntime(module, config, { localPlayer }), /Invalid local camera/);
    assert.deepEqual(calls, [["configure", 2, 0, 12345]]);
  }
});

async function rejectedSocket(address, origin) {
  const socket = new WebSocket(address, origin ? { origin } : {});
  socket.on("error", () => {});
  await new Promise((resolve, reject) => {
    socket.on("open", () => { socket.terminate(); reject(new Error("Unexpected upgrade")); });
    socket.on("unexpected-response", (_, response) => {
      response.resume(); socket.terminate(); assert.equal(response.statusCode, 403); resolve();
    });
  });
}

test("prototype endpoint rejects cross-origin upgrades and requires explicit opt-in", async t => {
  const { address } = await fixture(t);
  await rejectedSocket(address, "https://another-site.example");
  const app = createLobbyServer({ iceServers: [] });
  await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => app.close());
  await rejectedSocket("ws://127.0.0.1:" + app.server.address().port + "/online-v2");
});

test("early ready packets and departure during worker initialization clean up safely", async t => {
  let finishInit;
  let closed = false;
  const { connect } = await fixture(t, { simulationFactory: () => ({
    request: () => new Promise(resolve => { finishInit = resolve; }),
    close: async () => { closed = true; finishInit({ tick: 10, state, build: "test-build" }); },
  }) });
  const host = await connect();
  host.send({ type: "create", config });
  host.send({ type: "ready", tick: 10, build: "test-build", hash: observationHash(state) });
  assert.match((await host.next("error")).message, /still loading/);
  host.send({ type: "leave" });
  await host.next("left");
  assert.equal(closed, true);
});

test("prediction buffers controls for their exact tick and ignores late/future-slot rewrites", async t => {
  const { session, app } = await fixture(t);
  const { host, guest, code } = await session({ ...config, prediction: true });
  host.send({ type: "start" }); await host.next("started");
  guest.send({ type: "input", tick: 11, seq: 0, slot: 0, ...neutralPad(), buttons: 0x4000 });
  guest.send({ type: "join", code }); await guest.next("error");
  await app.prototype.advance(code);
  const first = await host.next("frame");
  assert.deepEqual(first.pads, [neutralPad(), neutralPad()]);
  assert.deepEqual(first.missingInputs, [true, true]);
  // The missed tick 10 cannot rewrite tick 11 or overwrite its queued input.
  guest.send({ type: "input", tick: 10, seq: 1, ...neutralPad(), buttons: 0x8000 });
  guest.send({ type: "join", code }); await guest.next("error");
  await app.prototype.advance(code);
  const second = await host.next("frame");
  assert.equal(second.pads[0].buttons, 0);
  assert.equal(second.pads[1].buttons, 0x4000);
  assert.deepEqual(second.missingInputs, [true, false]);
});

test("slow guest controls are accepted beyond rollback history but stay bounded and socket-owned", async t => {
  const inputs = [];
  const { session, app } = await fixture(t, { observeInput: input => inputs.push(input) });
  const { host, guest, code } = await session({ ...config, prediction: true });
  host.send({ type: "start" }); await host.next("started");
  guest.send({ type: "input", tick: 11 + MAX_INPUT_LEAD_TICKS, seq: 0, ...neutralPad(), buttons: 0x20 });
  guest.send({ type: "input", tick: 10 + MAX_INPUT_LEAD_TICKS, seq: 1, slot: 0, ...neutralPad(), buttons: 0x4000 });
  guest.send({ type: "join", code }); await guest.next("error");
  assert.deepEqual(inputs.map(input => input.status), ["invalid", "queued"]);
  for (let i = 0; i <= MAX_INPUT_LEAD_TICKS; i++) {
    await app.prototype.advance(code);
    const frame = await host.next("frame");
    assert.equal(frame.pads[0].buttons, 0);
    assert.equal(frame.pads[1].buttons, i === MAX_INPUT_LEAD_TICKS ? 0x4000 : 0);
  }
});

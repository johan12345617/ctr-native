import test from "node:test";
import assert from "node:assert/strict";
import { PredictionController } from "../online-v2-prediction.mjs";
import { MAX_PREDICTION_TICKS, OBSERVATION_BYTES, neutralPad, firstDifference } from "../online-v2-protocol.mjs";

const pad = buttons => ({ ...neutralPad(), buttons });
// A stateful interacting world substitute tests rollback behavior independently
// of the controller's implementation. Real original-game coverage uses the probe.
function world() {
  return {
    config: { players: 2 }, ready: true, tick: 10, value: 0, restores: 0,
    snapshots: new Map(), presentation: [],
    observe() {
      const bytes = new Uint8Array(OBSERVATION_BYTES);
      const view = new DataView(bytes.buffer);
      view.setUint32(0, this.tick, true); view.setUint32(4, this.value >>> 0, true);
      return Array.from(bytes);
    },
    step(pads, tick, present = true) {
      assert.equal(tick, this.tick);
      this.value = (Math.imul(this.value, 31) + pads[0].buttons + 3 * pads[1].buttons +
        (pads[0].buttons & pads[1].buttons)) >>> 0;
      this.tick++; this.presentation.push(present); return this.observe();
    },
    save(slot) {
      this.snapshots.set(slot, { tick: this.tick, value: this.value });
      return { bytes: 100, tick: this.tick };
    },
    restore(slot, expectedTick) {
      const saved = this.snapshots.get(slot);
      assert.equal(saved?.tick, expectedTick, "Never restore an overwritten checkpoint");
      this.tick = saved.tick; this.value = saved.value; this.restores++;
    },
  };
}
function frame(simulation, pads) {
  const state = simulation.step(pads, simulation.tick);
  return { tick: simulation.tick, pads, state };
}

test("menu/loading barriers use confirmed input and resume prediction in the next race", () => {
  const client = world(), authority = world();
  client.config.flow = "menu";
  Object.defineProperty(client, "canPredict", { get() { return this.tick >= 12 && this.tick < 15 || this.tick >= 18; } });
  const save = client.save;
  client.save = function(slot) { assert.equal(this.canPredict, true); return save.call(this, slot); };
  const prediction = new PredictionController(client, { slot: 0 });
  assert.equal(prediction.predict(pad(1)), null);
  for (let tick = 10; tick < 12; tick++) prediction.confirm(frame(authority, [pad(1), pad(0)]));
  assert.equal(client.canPredict, true);
  for (let tick = 12; tick < 15; tick++) prediction.predict(pad(2));
  assert.equal(client.tick, 15); assert.equal(prediction.predict(pad(3)), null);
  for (let tick = 12; tick < 18; tick++) prediction.confirm(frame(authority, [pad(2), pad(7)]));
  assert.equal(firstDifference(client.observe(), authority.observe()), -1);
  assert.equal(client.tick, 18); assert.ok(prediction.predict(pad(4)));
  prediction.confirm(frame(authority, [pad(4), pad(7)]));
  assert.equal(firstDifference(client.observe(), authority.observe()), -1);
});

test("local controls advance immediately; correction keeps later unconfirmed local controls", () => {
  const client = world(), authority = world(), expected = world();
  const prediction = new PredictionController(client, { slot: 0 });
  assert.equal(prediction.predict(pad(10)).tick, 10);
  assert.equal(client.tick, 11); assert.notEqual(client.value, 0);
  const later = pad(20);
  prediction.predict(later); later.buttons = 999;
  const confirmed = frame(authority, [pad(10), pad(9)]);
  const result = prediction.confirm(confirmed);
  frame(expected, [pad(10), pad(9)]); frame(expected, [pad(20), pad(9)]);
  assert.equal(result.corrected, true);
  assert.equal(client.tick, 12); assert.equal(prediction.confirmedTick, 11);
  assert.equal(client.value, expected.value);
  assert.equal(prediction.stats.replayedTicks, 1);
  assert.deepEqual(client.presentation.slice(-2), [false, true]);
  prediction.confirm(frame(authority, [pad(20), pad(12)]));
  assert.equal(firstDifference(client.observe(), authority.observe()), -1);
});

test("matching predictions are confirmed without restoring or replaying", () => {
  const client = world(), authority = world();
  const prediction = new PredictionController(client, { slot: 1 });
  prediction.predict(pad(7));
  const result = prediction.confirm(frame(authority, [pad(0), pad(7)]));
  assert.equal(result.corrected, false); assert.equal(client.restores, 0);
  assert.equal(prediction.stats.matchedFrames, 1); assert.equal(prediction.ahead, 0);
});

test("prediction stalls at its memory/window bound and resumes after confirmations", () => {
  const client = world(), authority = world();
  const prediction = new PredictionController(client, { slot: 0 });
  for (let i = 0; i < MAX_PREDICTION_TICKS; i++) assert.ok(prediction.predict(pad(i)));
  assert.equal(prediction.predict(pad(9)), null);
  assert.equal(prediction.checkpoints.size, MAX_PREDICTION_TICKS + 1);
  assert.equal(client.snapshots.size, MAX_PREDICTION_TICKS + 1);
  prediction.confirm(frame(authority, [pad(99), pad(88)]));
  assert.ok(prediction.predict(pad(22)));
  for (let i = 1; i <= MAX_PREDICTION_TICKS; i++) {
    prediction.confirm(frame(authority, [pad(i), pad(i + 1)]));
  }
  assert.equal(firstDifference(client.observe(), authority.observe()), -1);
  assert.equal(prediction.pending.size, 0);
});

test("duplicates are ignored; gaps, malformed controls and irreproducible authority fail explicitly", () => {
  const client = world(), authority = world();
  const prediction = new PredictionController(client, { slot: 0 });
  const initial = { tick: 10, pads: [pad(0), pad(0)], state: client.observe() };
  assert.equal(prediction.confirm(initial).ignored, true);
  assert.throws(() => prediction.confirm({ ...initial, tick: 12 }), /Missing authoritative tick/);
  assert.throws(() => prediction.predict(pad(-1)), /Invalid local/);
  assert.equal(client.tick, 10);
  prediction.predict(pad(3));
  const forged = frame(authority, [pad(3), pad(0)]); forged.state[7] ^= 1;
  assert.throws(() => prediction.confirm(forged), /Authoritative replay diverged/);
});

test("confirmed frames catch up a client that has no outstanding prediction", () => {
  const client = world(), authority = world();
  const prediction = new PredictionController(client, { slot: 0 });
  prediction.confirm(frame(authority, [pad(2), pad(3)]));
  assert.equal(client.value, authority.value);
  assert.equal(prediction.stats.catchupFrames, 1);
  assert.equal(prediction.ahead, 0);
  assert.ok(prediction.predict(pad(10)));
});

test("a queued authoritative batch restores once and preserves the remaining local prediction", () => {
  const client = world(), authority = world(), expected = world();
  const prediction = new PredictionController(client, { slot: 0 });
  for (let i = 0; i < 4; i++) prediction.predict(pad(10 + i));
  const frames = [];
  for (let i = 0; i < 3; i++) {
    frames.push(frame(authority, [pad(10 + i), pad(20 + i)]));
    frame(expected, [pad(10 + i), pad(20 + i)]);
  }
  frame(expected, [pad(13), pad(22)]);
  const results = prediction.confirmBatch(frames);
  assert.equal(client.restores, 1);
  assert.equal(prediction.stats.corrections, 1);
  assert.equal(prediction.confirmedTick, 13);
  assert.equal(client.tick, 14);
  assert.equal(client.value, expected.value);
  assert.equal(results.length, 3);
  assert.equal(prediction.pending.size, 1);
  assert.equal(prediction.checkpoints.size, 2);
  assert.deepEqual(client.presentation.slice(-4), [false, false, false, true]);
});

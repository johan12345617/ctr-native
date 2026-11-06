import { MAX_PREDICTION_TICKS, PREDICTION_CHECKPOINTS, MAX_TICK,
  neutralPad, copyPad, samePad, validPad, validObservation, firstDifference, observationHash } from "./online-v2-protocol.mjs";

// One locally rendered world. Checkpoints never cross the network; correction
// replays the authority's actual controls through the original game simulation.
export class PredictionController {
  constructor(simulation, { slot, maxPredictionTicks = MAX_PREDICTION_TICKS } = {}) {
    if (simulation.config.players !== 2 || ![0, 1].includes(slot) || !simulation.ready ||
      !Number.isInteger(maxPredictionTicks) || maxPredictionTicks < 1 || maxPredictionTicks > MAX_PREDICTION_TICKS) {
      throw new Error("Prediction requires a loaded two-player race and a valid local slot/window.");
    }
    this.simulation = simulation;
    this.slot = slot;
    this.maxPredictionTicks = maxPredictionTicks;
    this.confirmedTick = simulation.tick;
    this.confirmedPads = [neutralPad(), neutralPad()];
    this.pending = new Map();
    this.checkpoints = new Map();
    this.stats = { predictions: 0, corrections: 0, replayedTicks: 0, matchedFrames: 0,
      catchupFrames: 0, windowStalls: 0, maxAhead: 0, checkpointBytes: 0, maxCorrectionMs: 0,
      checkpointTimeMs: 0, maxCheckpointMs: 0, predictionTimeMs: 0, maxPredictionMs: 0 };
    this.checkpoint();
  }
  checkpoint() {
    if (this.simulation.canPredict === false) return;
    const tick = this.simulation.tick;
    const slot = 1 + tick % PREDICTION_CHECKPOINTS;
    const snapshot = this.simulation.save(slot);
    this.stats.checkpointTimeMs += snapshot.milliseconds || 0;
    this.stats.maxCheckpointMs = Math.max(this.stats.maxCheckpointMs, snapshot.milliseconds || 0);
    for (const [oldTick, oldSlot] of this.checkpoints) if (oldSlot === slot) this.checkpoints.delete(oldTick);
    this.checkpoints.set(tick, slot);
    this.stats.checkpointBytes = snapshot.bytes;
  }
  get ahead() { return this.simulation.tick - this.confirmedTick; }
  predict(localPad, present = true) {
    if (!validPad(localPad)) throw new Error("Invalid local prediction controls.");
    if (this.simulation.canPredict === false) return null;
    if (this.ahead >= this.maxPredictionTicks) { this.stats.windowStalls++; return null; }
    const tick = this.simulation.tick;
    const started = performance.now();
    if (tick >= MAX_TICK) throw new Error("Prediction tick limit reached.");
    const pads = this.confirmedPads.map(copyPad);
    pads[this.slot] = copyPad(localPad);
    const state = this.simulation.step(pads, tick, present);
    this.pending.set(tick, { pads, localPad: copyPad(localPad), state: Uint8Array.from(state) });
    this.checkpoint();
    this.stats.predictions++;
    const duration = performance.now() - started;
    this.stats.predictionTimeMs += duration;
    this.stats.maxPredictionMs = Math.max(this.stats.maxPredictionMs, duration);
    this.stats.maxAhead = Math.max(this.stats.maxAhead, this.ahead);
    return { tick, pad: copyPad(localPad), predictedTick: this.simulation.tick };
  }
  confirm(frame) {
    return this.confirmBatch([frame])[0];
  }
  confirmBatch(frames) {
    if (!Array.isArray(frames) || frames.length > 120) throw new Error("Invalid authoritative frame batch.");
    let expected = this.confirmedTick + 1;
    const accepted = [], results = [];
    for (const frame of frames) {
      if (!Number.isInteger(frame?.tick) || frame.tick < 0 || frame.tick > MAX_TICK ||
        !Array.isArray(frame.pads) || frame.pads.length !== 2 || !frame.pads.every(validPad) || !validObservation(frame.state)) {
        throw new Error("Invalid authoritative prediction frame.");
      }
      if (frame.tick < expected) { results.push({ ignored: true, tick: frame.tick }); continue; }
      if (frame.tick !== expected) throw new Error("Missing authoritative tick: expected " + expected + ", received " + frame.tick + ".");
      expected++; accepted.push(frame);
      results.push({ tick: frame.tick, hash: observationHash(frame.state), corrected: false });
    }
    if (!accepted.length) return results;
    const started = performance.now();
    const oldHead = this.simulation.tick;
    const last = accepted.at(-1);
    const firstMismatch = accepted.findIndex(frame => {
      const prediction = this.pending.get(frame.tick - 1);
      return !prediction || !prediction.pads.every((pad, slot) => samePad(pad, frame.pads[slot])) ||
        firstDifference(prediction.state, frame.state) !== -1;
    });
    if (firstMismatch === -1) this.stats.matchedFrames += accepted.length;
    else {
      this.stats.matchedFrames += firstMismatch;
      const inputTick = accepted[firstMismatch].tick - 1;
      let restored = false;
      if (inputTick < oldHead) {
        const checkpointSlot = this.checkpoints.get(inputTick);
        if (checkpointSlot === undefined) throw new Error("Authoritative correction exceeds the retained prediction window.");
        this.simulation.restore(checkpointSlot, inputTick);
        restored = true;
      } else if (oldHead !== inputTick) throw new Error("Prediction history is missing its confirmed checkpoint.");
      // Consume an accumulated confirmation backlog before rebuilding the
      // predicted present. Rendering and saving every intermediate authority
      // frame would multiply the correction cost on a slow graphical client.
      for (const frame of accepted.slice(firstMismatch)) {
        const state = this.simulation.step(frame.pads, frame.tick - 1, frame === last && oldHead <= last.tick);
        this.verify(frame, state);
        if (!this.pending.has(frame.tick - 1)) this.stats.catchupFrames++;
      }
      this.checkpoint();
      for (let tick = last.tick; tick < oldHead; tick++) {
        if (this.simulation.canPredict === false) {
          for (const pendingTick of this.pending.keys()) if (pendingTick >= tick) this.pending.delete(pendingTick);
          break;
        }
        const previous = this.pending.get(tick);
        if (!previous) throw new Error("Unconfirmed local input history is missing.");
        const pads = last.pads.map(copyPad);
        pads[this.slot] = copyPad(previous.localPad);
        const state = this.simulation.step(pads, tick, tick === oldHead - 1);
        this.pending.set(tick, { pads, localPad: previous.localPad, state: Uint8Array.from(state) });
        this.checkpoint();
        this.stats.replayedTicks++;
      }
      if (restored) {
        this.stats.corrections++;
        results.find(result => result.tick === accepted[firstMismatch].tick).corrected = true;
      }
      this.stats.maxCorrectionMs = Math.max(this.stats.maxCorrectionMs, performance.now() - started);
    }
    this.confirmedTick = last.tick;
    this.confirmedPads = last.pads.map(copyPad);
    for (const tick of this.pending.keys()) if (tick < last.tick) this.pending.delete(tick);
    for (const tick of this.checkpoints.keys()) if (tick < last.tick) this.checkpoints.delete(tick);
    return results.map(result => result.ignored ? result : { ...result, predictedTick: this.simulation.tick,
      ahead: this.ahead, stats: { ...this.stats } });
  }
  verify(frame, state) {
    const byte = firstDifference(state, frame.state);
    if (byte !== -1) throw new Error("Authoritative replay diverged at tick " + frame.tick + " (byte " + byte + ").");
  }
}

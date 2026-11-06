import { OBSERVATION_BYTES, PREDICTION_CHECKPOINTS, MAX_TICK, validConfig, validPad } from "./online-v2-protocol.mjs";

// Same adapter for the Node authority and local browser simulations.
export class SimulationRuntime {
  constructor(module, config, { localPlayer } = {}) {
    if (!validConfig(config) || module._CTR_OnlineConfigure(config.players, config.track, config.seed) !== 1) {
      throw new Error("Unsupported simulation configuration (2–4 humans, VS tracks 0–17).");
    }
    if (config.flow === "menu" && module._CTR_OnlineSetMenuFlow?.(1) !== 1) throw new Error("This build lacks online menu flow.");
    if (localPlayer !== undefined && (!Number.isInteger(localPlayer) || localPlayer < 0 || localPlayer >= config.players ||
      typeof module._CTR_OnlineSetLocalPlayer !== "function" || module._CTR_OnlineSetLocalPlayer(localPlayer) !== 1)) {
      throw new Error("Invalid local camera slot or browser build lacks individual-camera support.");
    }
    this.module = module;
    this.config = config;
    this.buffer = module._malloc(OBSERVATION_BYTES);
    if (!this.buffer) throw new Error("Could not allocate observation buffer.");
    const result = module.callMain([]);
    if (result !== 0) {
      module._free(this.buffer);
      this.buffer = 0;
      throw new Error("Game initialization failed (exit " + result + "). Check the local NTSC-U disc assets.");
    }
    const ptr = module._CTR_OnlineBuild();
    let end = ptr;
    while (module.HEAPU8[end]) end++;
    this.build = new TextDecoder().decode(module.HEAPU8.subarray(ptr, end));
  }
  get tick() { return this.module._CTR_OnlineTick(); }
  get ready() { return this.module._CTR_OnlineReady() === 1; }
  get canPredict() { return this.config.flow !== "menu" || this.module._CTR_OnlineCanPredict() === 1; }
  get view() {
    const read = this.module._CTR_OnlineViewInfo;
    return read ? { slot: read(0), width: read(1), height: read(2), renderedMask: read(3),
      minimap: { right: read(4), bottom: read(5), available: read(6) === 1 } } : undefined;
  }
  setupFixture(fixture) {
    if (!fixture || !Number.isInteger(fixture.scenario) || ![0, 1].includes(fixture.juiced) ||
      typeof this.module._CTR_OnlineTestSetup !== "function") throw new Error("Private power-up fixture build required.");
    const neutral = Array.from({ length: this.config.players }, () => ({ buttons: 0, axes: [128, 128, 128, 128] }));
    // Reach actual racing state before injecting a controlled test inventory.
    if (fixture.scenario !== 109) for (let i = 0; i < 180; i++) this.step(neutral);
    if (this.module._CTR_OnlineTestSetup(fixture.scenario, fixture.juiced) !== 1) throw new Error("Power-up fixture setup failed.");
  }
  observe() {
    if (this.module._CTR_OnlineObserve(this.buffer, OBSERVATION_BYTES) !== OBSERVATION_BYTES) {
      throw new Error("Could not observe simulation.");
    }
    return Array.from(this.module.HEAPU8.subarray(this.buffer, this.buffer + OBSERVATION_BYTES));
  }
  step(pads, tick = this.tick, present = true) {
    if (!Array.isArray(pads) || pads.length !== this.config.players || !pads.every(validPad)) {
      throw new Error("Invalid player controls.");
    }
    if (tick !== this.tick) throw new Error("Out-of-order simulation tick.");
    for (let slot = 0; slot < pads.length; slot++) {
      if (this.module._CTR_OnlineSetPad(slot, pads[slot].buttons, ...pads[slot].axes) !== 1) {
        throw new Error("Could not install player controls.");
      }
    }
    this.module._CTR_OnlineSetPresentation?.(present ? 1 : 0);
    try {
      if (this.module._CTR_OnlineStep(tick) !== 1) throw new Error("Simulation step failed.");
    } finally { this.module._CTR_OnlineSetPresentation?.(1); }
    return this.observe();
  }
  save(slot = 0) {
    if (!Number.isInteger(slot) || slot < 0 || slot > PREDICTION_CHECKPOINTS) throw new Error("Invalid checkpoint slot.");
    const start = performance.now();
    const bytes = slot === 0 ? this.module._CTR_OnlineSave() : this.module._CTR_OnlineSaveSlot(slot);
    if (!bytes) throw new Error("Checkpoint capture failed; wait for the track to finish loading.");
    return { bytes, milliseconds: performance.now() - start, tick: this.tick };
  }
  restore(slot = 0, expectedTick) {
    if (!Number.isInteger(slot) || slot < 0 || slot > PREDICTION_CHECKPOINTS ||
      (slot !== 0 && (!Number.isInteger(expectedTick) || expectedTick < 0 || expectedTick > MAX_TICK))) {
      throw new Error("Invalid checkpoint slot or expected tick.");
    }
    const start = performance.now();
    const result = slot === 0 ? this.module._CTR_OnlineRestore() : this.module._CTR_OnlineRestoreSlot(slot, expectedTick);
    if (result !== 1) throw new Error("Checkpoint restore failed or requested tick was overwritten.");
    return { milliseconds: performance.now() - start, tick: this.tick, state: this.observe() };
  }
  close() {
    if (!this.buffer) return;
    this.module._free(this.buffer);
    this.buffer = 0;
    this.module._CTR_OnlineShutdown();
  }
}

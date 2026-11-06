import { SimulationRuntime } from "./online-v2-runtime.mjs";
import { PROTOCOL, TICK_MS, firstDifference, neutralPad, observationHash, validObservation, validConfig, validPad, copyPad, decodeFrame } from "./online-v2-protocol.mjs";
import { KEY_BUTTONS, BrowserGamepads, focusGamepadScreen } from "./input.js";
import { PredictionController } from "./online-v2-prediction.mjs";
import { LatencyEstimator } from "./online-v2-latency.mjs";

const logStatus = status => {
  // Per-tick world dumps in an open console can themselves delay input. Keep
  // routine timing/frame events available to explicit telemetry subscribers.
  if (!["frame", "prediction", "reconciliation"].includes(status.type)) console.log(status);
};

// Developer-facing two-player prediction client, with the original confirmed-
// input feasibility mode available through create({ prediction: false }).
export class OnlineV2Client {
  constructor({ createModule, disc, canvas, onStatus = logStatus, getInput, beforeLoad,
    url = new URL("/online-v2", location.href).href.replace(/^http/, "ws") }) {
    if (window.ctrHost?.running && !beforeLoad) throw new Error("Reload the launcher before starting a local feasibility simulation.");
    if (typeof createModule !== "function" || !disc || !canvas) throw new Error("Provide createModule, your disc File, and a canvas.");
    this.createModule = createModule; this.disc = disc; this.canvas = canvas;
    this.onStatus = onStatus; this.keys = new Set(); this.seq = 0; this.closed = false;
    this.beforeLoad = beforeLoad;
    this.authoritativeFrames = [];
    const gamepads = new BrowserGamepads();
    this.gamepads = gamepads;
    this.getInput = getInput || (() => {
      const pad = gamepads.read(document.activeElement === canvas ? this.keys : [], undefined, document.hidden);
      focusGamepadScreen(canvas, gamepads.previous.get(gamepads.selectedIndex) || neutralPad());
      return pad;
    });
    this.socket = new WebSocket(url);
    this.socket.binaryType = "arraybuffer";
    this.socket.onmessage = event => {
      try { void this.receive(typeof event.data === "string" ? JSON.parse(event.data) : decodeFrame(event.data)).catch(error => this.close(error.message)); }
      catch (error) { this.close(error.message); }
    };
    this.pings = new Map(); this.pingSequence = 0;
    this.latency = new LatencyEstimator();
    this.socket.onerror = () => this.close("Could not connect to the Online 2.0 prototype server.");
    this.socket.onclose = event => this.close(event.reason || "Online session disconnected.");
    this.keyDown = event => {
      if (document.activeElement === canvas && Object.hasOwn(KEY_BUTTONS, event.code)) {
        this.keys.add(event.code); event.preventDefault();
      }
    };
    this.keyUp = event => this.keys.delete(event.code);
    this.blur = () => this.keys.clear();
    window.addEventListener("keydown", this.keyDown); window.addEventListener("keyup", this.keyUp);
    window.addEventListener("blur", this.blur);
  }
  send(message) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message)); }
  async connect() {
    if (this.socket.readyState === WebSocket.OPEN) return;
    if (this.closed) throw new Error("Client is closed.");
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("close", () => reject(new Error("Prototype connection failed.")), { once: true });
    });
  }
  async create({ players = 2, track = 0, seed = 12345, prediction = players === 2, flow } = {}) {
    await this.connect(); this.send({ type: "create", config: { protocol: PROTOCOL, players, track, seed, prediction, ...(flow ? { flow } : {}) } });
  }
  async join(code) { await this.connect(); this.send({ type: "join", code }); }
  start() { this.send({ type: "start" }); }
  async receive(message) {
    if (this.closed) return;
    if (message.type === "hello") {
      if (message.protocol !== PROTOCOL) throw new Error("Online protocol differs; reload the matching browser build.");
      this.ping(); this.pingTimer = setInterval(() => this.ping(), 1000);
    }
    if (message.type === "pong") {
      const sent = this.pings.get(message.nonce);
      if (sent !== undefined) {
        this.pings.delete(message.nonce);
        const sample = performance.now() - sent;
        if (this.latency.record(sample)) this.onStatus({ type: "latency", ...this.latency, predictionLead: this.latency.predictionLead });
      }
      return;
    }
    if (message.type === "session") {
      if (this.simulation || this.loading || !validConfig(message.config) || !validObservation(message.state)) throw new Error("Invalid session initialization.");
      this.loading = true;
      this.slot = message.slot;
      this.config = message.config;
      this.onStatus({ type: "loading", code: message.code, slot: this.slot });
      await this.beforeLoad?.();
      if (this.closed) return;
      const module = await this.createModule({ canvas: this.canvas, noInitialRun: true, print() {}, printErr: console.error });
      if (this.closed) return;
      module.FS.mkdirTree("/assets"); module.FS.mkdirTree("/memcards");
      module.FS.writeFile("/assets/ctr-u.bin", new Uint8Array(await this.disc.arrayBuffer()), { canOwn: true });
      if (this.closed) return;
      module._CTR_WebSetGamepad?.(0, 0, 0, 128, 128, 128, 128);
      module.ctrGamepadRumble = (slot, strong, weak) => {
        if (slot === this.slot) this.gamepads.rumble(undefined, strong, weak);
      };
      this.simulation = new SimulationRuntime(module, message.config, { localPlayer: this.slot });
      const pads = Array.from({ length: message.config.players }, neutralPad);
      while (!this.simulation.ready && this.simulation.tick < 2000) {
        this.simulation.step(pads);
        if (this.simulation.tick % 8 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        if (this.closed) return;
      }
      if (message.fixture) this.simulation.setupFixture(message.fixture);
      const state = this.simulation.observe();
      const byte = firstDifference(state, message.state);
      this.onStatus({ type: "loaded", code: message.code, tick: this.simulation.tick, firstDifference: byte });
      this.send({ type: "ready", tick: this.simulation.tick, build: this.simulation.build, hash: observationHash(state) });
      return;
    }
    if (message.type === "started") {
      if (!this.simulation || this.simulation.tick !== message.tick) throw new Error("Start tick differs from local simulation.");
      if (this.prediction || this.inputTimer) throw new Error("Session already started.");
      if (this.config.prediction) {
        this.prediction = new PredictionController(this.simulation, { slot: this.slot });
        // Keep enough lead to cover outgoing controls and incoming confirmation
        // delay. The first control is still simulated immediately on this client.
        this.replenishPrediction();
        this.inputTimer = setInterval(() => {
          try { this.predict(); } catch (error) { this.close(error.message); }
        }, TICK_MS);
      } else {
        this.inputTimer = setInterval(() => this.send({ type: "input", seq: this.seq++, tick: this.simulation.tick, ...this.getInput() }), TICK_MS);
      }
      this.canvas.focus();
    }
    if (message.type === "frame") {
      if (!this.simulation || !validObservation(message.state)) throw new Error("Invalid authoritative frame.");
      if (this.prediction) {
        if (this.authoritativeFrames.length >= 120) throw new Error("Graphical client exceeded the confirmation backlog limit.");
        this.authoritativeFrames.push(message);
        this.confirmTimer ??= setTimeout(() => {
          this.confirmTimer = undefined;
          try { this.flushConfirmations(); } catch (error) { this.close(error.message); }
        }, 0);
        return;
      } else {
        const state = this.simulation.step(message.pads, message.tick - 1);
        const byte = firstDifference(state, message.state);
        this.send({ type: "report", tick: message.tick, hash: observationHash(state) });
        if (byte !== -1) this.onStatus({ type: "divergence", tick: message.tick, byte });
      }
    }
    if (message.type === "closed") { this.close(message.reason); return; }
    this.onStatus(message);
  }
  predict() {
    const sampledAt = performance.now();
    const pad = this.getInput({ tick: this.simulation.canPredict ? this.racingInputTick(this.simulation.tick) : this.simulation.tick, slot: this.slot });
    if (!validPad(pad)) throw new Error("Invalid local prediction controls.");
    if (!this.simulation.canPredict) { this.sendMenuInput(pad); return; }
    if (this.prediction.ahead < this.prediction.maxPredictionTicks) {
      this.stepPrediction(this.sendRacingInput(this.simulation.tick, pad), true, sampledAt);
    } else {
      this.stepPrediction(pad, true, sampledAt);
    }
  }
  racingInputTick(tick) {
    return tick + Math.max(0, this.latency.inputLead - this.prediction.maxPredictionTicks);
  }
  sendRacingInput(tick, pad) {
    const inputTick = this.racingInputTick(tick);
    this.scheduledInputs ??= new Map();
    this.scheduledInputs.set(inputTick, copyPad(pad));
    this.send({ type: "input", seq: this.seq++, tick: inputTick, ...pad });
    // At RTTs exceeding the rollback window, apply this control at its planned
    // tick in both worlds. Short connections still apply it immediately.
    for (const [plannedTick, plannedPad] of this.scheduledInputs) {
      if (plannedTick > tick) continue;
      if (plannedTick >= (this.appliedInputTick ?? -1)) {
        this.appliedInputTick = plannedTick; this.appliedInputPad = plannedPad;
      }
      this.scheduledInputs.delete(plannedTick);
    }
    return copyPad(this.appliedInputPad || neutralPad());
  }
  stepPrediction(pad, present = true, sampledAt = performance.now()) {
    const prediction = this.prediction.predict(pad, present);
    if (!prediction) return;
    this.onStatus({ type: "prediction", tick: prediction.predictedTick, confirmedTick: this.prediction.confirmedTick,
      inputToPredictionMs: performance.now() - sampledAt });
  }
  replenishPrediction() {
    if (!this.simulation.canPredict) { this.sendMenuInput(this.getInput({ tick: this.simulation.tick, slot: this.slot })); return; }
    const plans = [];
    // Fill the bounded window after a confirmation batch. This covers the round
    // trip and graphical correction time; the regular timer can predict when a
    // confirmation has freed space before this batch is processed.
    const lead = Math.min(this.prediction.maxPredictionTicks, this.latency.predictionLead);
    for (let i = 0; i < lead - this.prediction.ahead; i++) {
      const tick = this.simulation.tick + i;
      const pad = this.getInput({ tick: this.racingInputTick(tick), slot: this.slot });
      if (!validPad(pad)) throw new Error("Invalid local prediction controls.");
      plans.push({ tick, pad: copyPad(pad), sampledAt: performance.now() });
    }
    // Send a sampled burst before its rendered simulation work. A slow GPU
    // should not hold already-sampled controls past their server deadlines.
    for (const plan of plans) plan.appliedPad = this.sendRacingInput(plan.tick, plan.pad);
    for (let i = 0; i < plans.length; i++) this.stepPrediction(plans[i].appliedPad, i === plans.length - 1, plans[i].sampledAt);
  }
  sendMenuInput(pad) {
    if (!validPad(pad)) throw new Error("Invalid menu controls.");
    const unchanged = this.menuInputPad?.buttons === pad.buttons && pad.axes.every((axis, i) => axis === this.menuInputPad.axes[i]);
    let tick = Math.max(this.simulation.tick + this.latency.inputLead - 1, this.menuInputTick ?? -1);
    if (tick === this.menuInputTick) {
      if (unchanged) return;
      // Preserve press/release edges when confirmations arrive in a batch.
      tick++;
    }
    this.menuInputTick = tick; this.menuInputPad = copyPad(pad);
    this.send({ type: "input", seq: this.seq++, tick, ...pad });
  }
  flushConfirmations() {
    const frames = this.authoritativeFrames.splice(0);
    const started = performance.now();
    const confirmations = this.prediction.confirmBatch(frames);
    this.onStatus({ type: "reconciliation", milliseconds: performance.now() - started, frames: frames.length });
    for (let i = 0; i < confirmations.length; i++) {
      const confirmation = confirmations[i];
      if (confirmation.ignored) continue;
      this.send({ type: "report", tick: confirmation.tick, hash: confirmation.hash });
      if (confirmation.corrected) this.onStatus({ type: "correction", ...confirmation });
      this.onStatus(frames[i]);
    }
    this.replenishPrediction();
  }
  ping() {
    const nonce = ++this.pingSequence;
    const now = performance.now();
    for (const [key, sent] of this.pings) if (now - sent > 10000) this.pings.delete(key);
    this.pings.set(nonce, now); this.send({ type: "ping", nonce });
  }
  close(reason = "Feasibility client closed.") {
    if (this.closed) return;
    this.closed = true; clearInterval(this.inputTimer); clearTimeout(this.confirmTimer); clearInterval(this.pingTimer);
    this.pings.clear();
    this.authoritativeFrames.length = 0;
    this.send({ type: "leave" }); this.socket.close();
    window.removeEventListener("keydown", this.keyDown); window.removeEventListener("keyup", this.keyUp);
    window.removeEventListener("blur", this.blur);
    this.simulation?.close(); this.onStatus({ type: "closed", reason });
  }
}

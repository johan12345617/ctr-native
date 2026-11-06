import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import { SimulationRuntime } from "./online-v2-runtime.mjs";
import { neutralPad } from "./online-v2-protocol.mjs";
import { PredictionController } from "./online-v2-prediction.mjs";

let simulation;
let prediction;
parentPort.on("message", async ({ id, type, ...args }) => {
  try {
    let result;
    if (type === "init") {
      if (simulation) throw new Error("Worker is already initialized.");
      const createModule = createRequire(import.meta.url)(workerData.engine);
      const module = await createModule({ noInitialRun: true, print() {}, printErr() {} });
      module.FS.mkdirTree("/assets");
      module.FS.mount(module.NODEFS, { root: workerData.assets }, "/assets");
      // All memory-card and log writes stay in this worker's ephemeral MEMFS.
      module.FS.mkdirTree("/memcards");
      simulation = new SimulationRuntime(module, args.config, { localPlayer: args.localPlayer });
      const neutral = Array.from({ length: args.config.players }, neutralPad);
      const start = performance.now();
      while (!simulation.ready && simulation.tick < 2000) simulation.step(neutral);
      if (!simulation.ready) throw new Error("Track did not finish loading within 2000 iterations.");
      if (args.fixture) simulation.setupFixture(args.fixture);
      result = { tick: simulation.tick, state: simulation.observe(), build: simulation.build, bootMs: performance.now() - start,
        ...(args.fixture ? { fixture: args.fixture } : {}) };
    } else {
      if (!simulation) throw new Error("Worker is not initialized.");
      if (type === "step") {
        const start = performance.now();
        const state = simulation.step(args.pads, args.tick);
        result = { tick: simulation.tick, state, milliseconds: performance.now() - start };
      } else if (type === "menu-info") result = { fields: Array.from({ length: 32 }, (_, field) => simulation.module._CTR_WebMenuInfo(field)), canPredict: simulation.canPredict };
      else if (type === "save") result = simulation.save(args.slot);
      else if (type === "restore") result = simulation.restore(args.slot, args.tick);
      else if (type === "prediction-init") {
        if (prediction) throw new Error("Prediction is already initialized.");
        prediction = new PredictionController(simulation, { slot: args.slot });
        result = { tick: simulation.tick, stats: prediction.stats };
      } else if (type === "predict") {
        if (!prediction) throw new Error("Prediction is not initialized.");
        result = { prediction: prediction.predict(args.pad), tick: simulation.tick, state: simulation.observe(), stats: { ...prediction.stats } };
      } else if (type === "confirm") {
        if (!prediction) throw new Error("Prediction is not initialized.");
        result = { confirmation: prediction.confirm(args.frame), tick: simulation.tick, state: simulation.observe(), stats: { ...prediction.stats } };
      }
      else throw new Error("Unknown simulation command.");
    }
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message });
  }
});

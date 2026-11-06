import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export class SimulationWorker {
  constructor({ engine = fileURLToPath(new URL("../build-online-v2/ctr_native.cjs", import.meta.url)),
    assets = fileURLToPath(new URL("../assets/", import.meta.url)), timeoutMs = 30000 } = {}) {
    this.worker = new Worker(new URL("./online-v2-worker.mjs", import.meta.url), {
      workerData: { engine: resolve(engine), assets: resolve(assets) },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.sequence = 0;
    this.busy = false;
    this.closed = false;
    this.worker.on("message", message => {
      const request = this.pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(message.id);
      this.busy = false;
      if (message.error) request.reject(new Error(message.error));
      else request.resolve(message.result);
    });
    this.worker.on("error", error => this.fail(error));
    this.worker.on("exit", code => this.fail(new Error("Simulation worker exited (" + code + ").")));
  }
  fail(error) {
    this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); }
    this.pending.clear();
  }
  request(type, args = {}) {
    if (this.closed) return Promise.reject(new Error("Simulation worker is closed."));
    if (this.busy) return Promise.reject(new Error("Simulation commands must run sequentially."));
    this.busy = true;
    const id = ++this.sequence;
    return new Promise((resolveRequest, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error("Simulation worker timed out."));
        void this.worker.terminate();
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolveRequest, reject, timer });
      this.worker.postMessage({ id, type, ...args });
    });
  }
  async close() { this.fail(new Error("Simulation worker closed.")); await this.worker.terminate(); }
}

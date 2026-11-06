import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationWorker } from "./online-v2-simulation.mjs";
import { PROTOCOL, TICK_MS, firstDifference, validConfig, observationHash } from "./online-v2-protocol.mjs";

export async function runProbe({ frames = 600, players = 2, track = 0, seed = 12345, engine, assets } = {}) {
  if (!Number.isInteger(frames) || frames < 1 || frames > 10000) throw new Error("frames must be between 1 and 10000.");
  const config = { protocol: PROTOCOL, players, track, seed };
  if (!validConfig(config)) throw new Error("Unsupported configuration: 2–4 players, tracks 0–17, uint32 seed.");
  const workers = Array.from({ length: 3 }, () => new SimulationWorker({ engine, assets }));
  const report = { config, frames, runtime: process.version, scope: "One Node/WASM authority and two isolated Node/WASM clients; diagnostic observation equality, not cross-browser or complete-world determinism.",
    reproducible: true, rollbackReproducible: true, firstDivergence: null, stepMs: [], snapshots: [], restoreMs: [],
    coverage: { movingFrames: 0, inventoryFrames: 0, maxAbsSpeed: 0 } };
  try {
    const initial = await Promise.all(workers.map(worker => worker.request("init", { config })));
    report.build = initial[0].build; report.bootMs = initial.map(value => value.bootMs);
    report.initialTick = initial[0].tick;
    const compare = (results, phase) => {
      for (let i = 1; i < results.length; i++) {
        const byte = firstDifference(results[0].state, results[i].state);
        if (byte !== -1) {
          report.reproducible = false;
          report.firstDivergence ||= { phase, tick: results[0].tick, client: i, byte };
        }
      }
    };
    compare(initial, "boot");
    report.snapshots = await Promise.all(workers.map(worker => worker.request("save")));
    const tape = Array.from({ length: frames }, (_, frame) => Array.from({ length: players }, (_, slot) => ({
      buttons: 0x4000 | (frame % 90 < 20 ? 0x0400 : 0) | (frame % 120 < 30 ? (slot % 2 ? 0x20 : 0x80) : 0) |
        (frame % 45 === 0 ? 0x2000 : 0), axes: [128, 128, 128, 128],
    })));
    const baseline = [];
    for (let frame = 0; frame < frames; frame++) {
      const results = await Promise.all(workers.map(worker => worker.request("step", { tick: report.initialTick + frame, pads: tape[frame] })));
      report.stepMs.push(results[0].milliseconds);
      baseline.push(results.map(result => Uint8Array.from(result.state)));
      const view = new DataView(Uint8Array.from(results[0].state).buffer);
      let moving = false, inventory = false;
      for (let slot = 0; slot < players; slot++) {
        const base = (16 + slot * 24) * 4;
        const speed = Math.abs(view.getInt32(base + 7 * 4, true));
        report.coverage.maxAbsSpeed = Math.max(report.coverage.maxAbsSpeed, speed);
        moving ||= speed > 0;
        inventory ||= view.getUint32(base + 14 * 4, true) > 0;
      }
      if (moving) report.coverage.movingFrames++;
      if (inventory) report.coverage.inventoryFrames++;
      compare(results, "forward");
    }
    const restored = await Promise.all(workers.map(worker => worker.request("restore")));
    report.restoreMs = restored.map(result => result.milliseconds);
    for (let i = 0; i < restored.length; i++) {
      if (firstDifference(initial[i].state, restored[i].state) !== -1) report.rollbackReproducible = false;
    }
    for (let frame = 0; frame < frames; frame++) {
      const results = await Promise.all(workers.map(worker => worker.request("step", { tick: report.initialTick + frame, pads: tape[frame] })));
      for (let i = 0; i < results.length; i++) {
        const byte = firstDifference(baseline[frame][i], results[i].state);
        if (byte !== -1) {
          report.rollbackReproducible = false;
          report.firstDivergence ||= { phase: "rollback", tick: results[i].tick, client: i, byte };
        }
      }
    }
    const sorted = [...report.stepMs].sort((a, b) => a - b);
    report.simulationMs = { mean: sorted.reduce((sum, value) => sum + value, 0) / frames,
      p95: sorted[Math.min(frames - 1, Math.floor(frames * 0.95))], max: sorted.at(-1), budget: TICK_MS };
    report.finalHashes = baseline.at(-1).map(observationHash);
    delete report.stepMs;
    report.passed = report.reproducible && report.rollbackReproducible && report.coverage.movingFrames > 0;
    return report;
  } finally { await Promise.all(workers.map(worker => worker.close())); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    let output;
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i].slice(2), value = process.argv[i + 1];
      if (!process.argv[i].startsWith("--") || value === undefined ||
        !["frames", "players", "track", "seed", "engine", "assets", "output"].includes(key)) throw new Error("Unknown or incomplete argument: " + process.argv[i]);
      if (key === "output") output = resolve(value);
      else options[key] = ["engine", "assets"].includes(key) ? resolve(value) : Number(value);
    }
    const report = await runProbe(options);
    const json = JSON.stringify(report, null, 2) + "\n";
    if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, json); }
    console.log(json);
    process.exitCode = report.passed ? 0 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

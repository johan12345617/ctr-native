import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationWorker } from "./online-v2-simulation.mjs";
import { PROTOCOL, firstDifference, observationHash, neutralPad } from "./online-v2-protocol.mjs";
import { racePad, physicsCoverage } from "./online-v2-race-tape.mjs";

export async function runPredictionProbe({ frames = 600, track = 0, seed = 12345, engine, assets } = {}) {
  if (!Number.isInteger(frames) || frames < 1 || frames > 10000) throw new Error("frames must be between 1 and 10000.");
  const config = { protocol: PROTOCOL, players: 2, track, seed, prediction: true };
  const authority = new SimulationWorker({ engine, assets });
  const clients = [new SimulationWorker({ engine, assets }), new SimulationWorker({ engine, assets })];
  const report = { config, frames, scope: "Original C/WASM authority and two locally predicted worlds; delayed ordered confirmations, jitter, and missed authority inputs.",
    passed: false, confirmedFrames: [0, 0], missedInputs: 0, firstDivergence: null, clients: [], coverage: undefined };
  try {
    const initial = await Promise.all([authority, ...clients].map((worker, index) => worker.request("init", {
      config, ...(index ? { localPlayer: index - 1 } : {}),
    })));
    report.build = initial[0].build;
    report.initialTick = initial[0].tick;
    for (let slot = 0; slot < 2; slot++) {
      if (firstDifference(initial[0].state, initial[slot + 1].state) !== -1) throw new Error("Initial world differs.");
    }
    await Promise.all(clients.map((client, slot) => client.request("prediction-init", { slot })));
    const deliveries = [[], []], lastDelivery = [0, 0];
    let finalAuthority;
    const confirm = async (slot, frame) => {
      const result = await clients[slot].request("confirm", { frame });
      if (result.confirmation.hash !== observationHash(frame.state)) throw new Error("Confirmed hash differs.");
      report.confirmedFrames[slot]++;
      report.clients[slot] = { ...result.stats, tick: result.tick, state: result.state };
    };
    for (let index = 0; index < frames; index++) {
      await Promise.all(clients.map((client, slot) => client.request("predict", { pad: racePad(index, slot) })));
      const pads = [racePad(index, 0), racePad(index, 1)];
      // Exercise corrections to the local player's controls too: an input that
      // missed its authority tick cannot retroactively become authoritative.
      if (index > 150 && index % 67 === 0) { pads[index % 2] = neutralPad(); report.missedInputs++; }
      finalAuthority = await authority.request("step", { tick: report.initialTick + index, pads });
      const frame = { tick: finalAuthority.tick, pads, state: finalAuthority.state };
      report.coverage = physicsCoverage(frame.state, report.coverage);
      for (let slot = 0; slot < 2; slot++) {
        const delay = (slot ? 4 : 2) + (index % 17 === 0 ? 2 : 0);
        lastDelivery[slot] = Math.max(lastDelivery[slot], index + delay);
        deliveries[slot].push({ at: lastDelivery[slot], frame });
      }
      await Promise.all(clients.map(async (_, slot) => {
        while (deliveries[slot][0]?.at <= index) await confirm(slot, deliveries[slot].shift().frame);
      }));
    }
    await Promise.all(clients.map(async (_, slot) => {
      for (const delivery of deliveries[slot]) await confirm(slot, delivery.frame);
    }));
    for (let slot = 0; slot < 2; slot++) {
      const byte = firstDifference(finalAuthority.state, report.clients[slot].state);
      if (byte !== -1) report.firstDivergence = { slot, tick: finalAuthority.tick, byte };
      delete report.clients[slot].state;
    }
    report.passed = !report.firstDivergence && report.confirmedFrames.every(count => count === frames) &&
      report.clients.every(client => client.predictions > 0 && client.corrections > 0 && client.replayedTicks > 0) &&
      ["movingFrames", "driftFrames", "boostFrames", "airborneFrames", "kartCollisionFrames"]
        .every(key => report.coverage[key] > 0);
    return report;
  } finally { await Promise.all([authority, ...clients].map(worker => worker.close())); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runPredictionProbe({ frames: Number(process.argv[2] || 600) });
    const json = JSON.stringify(report, null, 2) + "\n";
    if (process.argv[3]) {
      const output = resolve(process.argv[3]); await mkdir(dirname(output), { recursive: true }); await writeFile(output, json);
    }
    console.log(json); process.exitCode = report.passed ? 0 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

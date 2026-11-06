// Original menus, scoring/results and multi-level loading against two predicted
// worlds. Private fixture 109 finishes a round through original game code.
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationWorker } from "./online-v2-simulation.mjs";
import { PROTOCOL, neutralPad, firstDifference } from "./online-v2-protocol.mjs";

export async function runModeProbe(mode) {
  const engine = fileURLToPath(new URL("../build-online-v2-probe/ctr_native.cjs", import.meta.url));
  const worlds = Array.from({ length: 3 }, () => new SimulationWorker({ engine }));
  const [authority, ...clients] = worlds;
  const config = { protocol: PROTOCOL, players: 2, track: 0, seed: 12345, prediction: true, flow: "menu" };
  const report = { mode, passed: false, frames: 0, rounds: [], phase: "root", corrections: [], errors: [] };
  try {
    const initial = await Promise.all(worlds.map((worker, index) => worker.request("init", { config, fixture: { scenario: 109, juiced: 0 },
      ...(index ? { localPlayer: index - 1 } : {}) })));
    for (const client of initial.slice(1)) assert.equal(firstDifference(initial[0].state, client.state), -1);
    await Promise.all(clients.map((worker, slot) => worker.request("prediction-init", { slot })));
    const modeRow = { race: 0, cup: 1, battle: 2 }[mode];
    let tick = initial[0].tick, inRound = false, resultTick = 0, retryRequested = false;
    let lastStats = [];
    for (let step = 0; step < 6000; step++) {
      const { fields: f, canPredict } = await authority.request("menu-info");
      report.lastInfo = f; report.frames = step;
      const pads = [neutralPad(), neutralPad()];
      const pulse = step % 8 === 0;
      if (report.phase === "root" && f[12] === 1 && pulse) {
        pads[0].buttons = f[8] < modeRow ? 0x40 : 0x4000;
        if (f[8] === modeRow) report.phase = "characters";
      } else if (report.phase === "characters" && f[7] === 1 && f[16] === 1 && pulse) {
        pads[0].buttons = pads[1].buttons = 0x4000; report.phase = "selection";
      } else if (report.phase === "selection" && pulse) {
        if (f[7] === 4 && f[21] === 1) pads[0].buttons = f[31] < 5 ? 0x40 : 0x4000;
        else if (f[7] === 3 && f[20] === 1 || f[7] === 2 && f[19] === 1) pads[0].buttons = 0x4000;
      }
      if (canPredict && !f[26]) {
        report.phase = "driving";
        if (!inRound) {
          if (mode !== "cup" && report.rounds.length && retryRequested) {
            report.restarted = true; report.passed = true; break;
          }
          inRound = true;
        }
      }
      if (f[26]) {
        report.phase = "results";
        if (inRound) {
          inRound = false; resultTick = step;
          report.rounds.push({ level: f[2], cupTrack: f[11], points: [f[27], f[28]], lives: f[30], battlePoints: f[29] });
        }
        // Original VS/battle quips ask every player to continue before opening
        // the host's shared results menu.
        if (step - resultTick > 90 && step % 20 === 0) { pads[0].buttons = pads[1].buttons = 0x4000; retryRequested = true; }
      }
      if (mode === "cup" && report.rounds.length === 4 && f[11] === 0 && step - resultTick > 90) {
        report.completedCup = true; report.phase = "podium";
        if (step % 20 === 0) pads[0].buttons = pads[1].buttons = 0x4000;
        if (f[2] === 39 && f[1] === -1 && (f[12] === 1 || f[7] === 3)) {
          report.returnedToMenus = true; report.passed = true; break;
        }
      }
      // Menu/flag transitions run confirmed; driving predicts ahead and applies
      // deliberately wrong opponent steering to exercise real corrections.
      for (let slot = 0; slot < clients.length; slot++) {
        const pad = { ...pads[slot], axes: [...pads[slot].axes] };
        if (canPredict && step % 31 === 0) pad.buttons ^= 0x20;
        await clients[slot].request("predict", { pad });
      }
      const frame = await authority.request("step", { tick, pads }); tick = frame.tick;
      const corrected = await Promise.all(clients.map(worker => worker.request("confirm", { frame: { ...frame, pads } })));
      lastStats = corrected.map(result => result.stats);
      for (const result of corrected) assert.equal(firstDifference(frame.state, result.state), -1, "Mode/transition observations must converge.");
    }
    report.corrections = lastStats.map(stats => stats.corrections);
    assert.ok(report.passed, "Mode did not finish its original results/continuation flow.");
    assert.ok(report.corrections.every(count => count > 0), "Driving must exercise rollback.");
    if (mode === "cup") assert.deepEqual(report.rounds.map(round => round.cupTrack), [0, 1, 2, 3]);
    if (mode === "battle") assert.ok(report.rounds[0].level >= 18 && report.rounds[0].level < 25);
  } catch (error) { report.passed = false; report.errors.push(error.message); }
  finally { await Promise.all(worlds.map(worker => worker.close())); }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = resolve(process.argv[2] || ".cache/online-v2/modes.json");
  const modes = process.argv[3] ? [process.argv[3]] : ["race", "cup", "battle"];
  const report = { passed: true, cases: [] };
  for (const mode of modes) {
    const result = await runModeProbe(mode); report.cases.push(result); report.passed &&= result.passed;
    console.log(JSON.stringify(result));
  }
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.passed ? 0 : 2;
}

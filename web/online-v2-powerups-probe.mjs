import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SimulationWorker } from "./online-v2-simulation.mjs";
import { PROTOCOL, observationHash, firstDifference, neutralPad } from "./online-v2-protocol.mjs";

export const POWERUPS = ["turbo", "bomb", "missile", "TNT/nitro", "potion", "spring", "shield", "mask", "clock", "warpball",
  "three bombs", "three missiles", "invisibility", "super engine"];
export function weaponPad(index, slot, scenario) {
  if (scenario === 108) return neutralPad();
  let buttons = 0;
  if (scenario === 100) buttons = index === 5 ? 0x4000 : 0;
  else {
    if ([5, 35, 65].includes(index)) buttons |= 0x2000;
    if (index >= 15 && index % 30 < 3) buttons |= 0x0400;
    if (index === 5 && slot === 1) buttons |= 0x0040; // Original backward fire path.
    if (scenario >= 105 && index === 8) buttons |= 0x4000;
  }
  return { buttons, axes: [128, 128, 128, 128] };
}

export function powerupCoverage(state, baseline, result = { projectiles: 0, mines: 0, shields: 0, masks: 0, clockFrames: 0,
  inventoryChanges: 0, hits: 0, hitsBySlot: [0, 0], crateAwards: 0, awardsBySlot: [0, 0], superEngineFrames: 0,
  invisibleFrames: 0, boostFrames: 0, expiredEffects: {}, activeEffects: {} }) {
  const v = new DataView(Uint8Array.from(state).buffer), initial = new DataView(Uint8Array.from(baseline).buffer), extra = 832;
  for (const [key, word] of [["projectiles", 4], ["mines", 5], ["shields", 6], ["masks", 7]]) result[key] = Math.max(result[key], v.getUint32(extra + word * 4, true));
  let active = { clock: false, mask: v.getUint32(extra + 7 * 4, true) > 0, invisible: false, superEngine: false };
  for (let slot = 0; slot < 2; slot++) {
    const base = (16 + slot * 24) * 4, driver = extra + (8 + slot * 16) * 4;
    if (v.getUint32(base + 17 * 4, true)) { result.clockFrames++; active.clock = true; }
    if (v.getUint32(base + 20 * 4, true)) { result.invisibleFrames++; active.invisible = true; }
    if (v.getUint32(driver + 5 * 4, true)) { result.superEngineFrames++; active.superEngine = true; }
    if (v.getInt32(base + 8 * 4, true) > 0) result.boostFrames++;
    if (v.getUint32(base + 13 * 4, true) !== initial.getUint32(base + 13 * 4, true) ||
      v.getUint32(base + 14 * 4, true) !== initial.getUint32(base + 14 * 4, true)) result.inventoryChanges++;
    result.hitsBySlot[slot] = Math.max(result.hitsBySlot[slot], v.getUint32(driver + 8 * 4, true));
    result.awardsBySlot[slot] = Math.max(result.awardsBySlot[slot], v.getUint32(driver + 9 * 4, true));
  }
  result.hits = result.hitsBySlot.reduce((a, b) => a + b, 0); result.crateAwards = result.awardsBySlot.reduce((a, b) => a + b, 0);
  for (const key of Object.keys(active)) {
    if (active[key]) result.activeEffects[key] = true;
    else if (result.activeEffects[key]) result.expiredEffects[key] = true;
  }
  return result;
}

export function coveredPowerup(scenario, coverage) {
  const c = coverage;
  const effects = { 0: c.boostFrames > 0, 1: c.projectiles > 0, 2: c.projectiles > 0, 3: c.mines > 0, 4: c.mines > 0,
    5: true, // Unused original spring ID: normal item selection replaces it with turbo.
    6: c.shields > 0 && c.projectiles > 0, 7: c.masks > 0 && c.expiredEffects.mask,
    8: c.clockFrames > 0 && c.expiredEffects.clock, 9: c.projectiles > 0, 10: c.projectiles >= 2, 11: c.projectiles >= 2,
    12: c.invisibleFrames > 0 && c.expiredEffects.invisible, 13: c.superEngineFrames > 0 && c.expiredEffects.superEngine,
    100: c.crateAwards === 1 && c.awardsBySlot[0] === 1 && c.awardsBySlot[1] === 0,
    101: c.projectiles > 0 && c.clockFrames > 0, 102: c.projectiles > 0 && c.shields > 0,
    103: c.mines > 0 && c.masks > 0, 104: c.mines > 0 && c.boostFrames > 0,
    105: c.hitsBySlot.every(count => count > 0), 106: c.shields > 0 && c.hitsBySlot[1] === 0,
    107: c.masks > 0 && c.hitsBySlot[1] === 0 };
  return c.inventoryChanges > 0 && Boolean(effects[scenario]);
}

export async function runPowerupCase({ scenario, juiced, frames = 420, track = 0,
  engine = fileURLToPath(new URL("../build-online-v2-probe/ctr_native.cjs", import.meta.url)), assets } = {}) {
  const config = { protocol: PROTOCOL, players: 2, track, seed: 12345, prediction: true };
  const fixture = { scenario, juiced };
  const authority = new SimulationWorker({ engine, assets });
  const clients = [new SimulationWorker({ engine, assets }), new SimulationWorker({ engine, assets })];
  const report = { scenario, track, name: POWERUPS[scenario] || (scenario === 100 ? "contested crate" : "simultaneous effects " + scenario), juiced,
    frames, passed: false, confirmed: [0, 0], firstDivergence: null, clients: [],
    coverage: undefined };
  try {
    const initial = await Promise.all([authority, ...clients].map((worker, index) => worker.request("init", {
      config, fixture, ...(index ? { localPlayer: index - 1 } : {}),
    })));
    for (let slot = 0; slot < 2; slot++) if (firstDifference(initial[0].state, initial[slot + 1].state) !== -1) throw new Error("Fixture initial state differs.");
    await Promise.all(clients.map((worker, slot) => worker.request("prediction-init", { slot })));
    const initialTick = initial[0].tick;
    const pending = [[], []];
    let final;
    async function confirm(slot, frame) {
      const result = await clients[slot].request("confirm", { frame });
      if (result.confirmation.hash !== observationHash(frame.state)) throw new Error("Power-up confirmation differs.");
      report.confirmed[slot]++; report.clients[slot] = { ...result.stats, state: result.state };
    }
    for (let index = 0; index < frames; index++) {
      await Promise.all(clients.map((worker, slot) => worker.request("predict", { pad: weaponPad(index, slot, scenario) })));
      const pads = [weaponPad(index, 0, scenario), weaponPad(index, 1, scenario)];
      // The authority grants the contested crate to player 0; player 1 locally
      // predicts it from missing remote input, then must undo that inventory/RNG.
      if (scenario === 100 && index === 5) pads[1] = neutralPad();
      final = await authority.request("step", { tick: initialTick + index, pads });
      const frame = { tick: final.tick, state: final.state, pads };
      report.coverage = powerupCoverage(final.state, initial[0].state, report.coverage);
      for (let slot = 0; slot < 2; slot++) pending[slot].push({ at: index + 2 + slot * 2, frame });
      await Promise.all(clients.map(async (_, slot) => {
        while (pending[slot][0]?.at <= index) await confirm(slot, pending[slot].shift().frame);
      }));
    }
    await Promise.all(clients.map(async (_, slot) => { for (const entry of pending[slot]) await confirm(slot, entry.frame); }));
    for (let slot = 0; slot < 2; slot++) {
      const byte = firstDifference(final.state, report.clients[slot].state);
      if (byte !== -1) report.firstDivergence = { slot, byte };
      delete report.clients[slot].state;
    }
    report.passed = !report.firstDivergence && report.confirmed.every(count => count === frames) &&
      coveredPowerup(scenario, report.coverage);
    return report;
  } catch (error) { report.error = error.message; return report; }
  finally { await Promise.all([authority, ...clients].map(worker => worker.close())); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scenarios = process.argv[2] === undefined || process.argv[2] === "all" ? [...Array(14).keys(), 100, 101, 102, 103, 104, 105, 106, 107] : [Number(process.argv[2])];
  const report = { passed: true, cases: [] };
  for (const scenario of scenarios) for (const juiced of [0, 1]) {
    const result = await runPowerupCase({ scenario, juiced }); report.cases.push(result); report.passed &&= result.passed;
    console.log(JSON.stringify({ scenario, juiced, passed: result.passed, coverage: result.coverage, error: result.error }));
  }
  if (process.argv[3]) { const path = resolve(process.argv[3]); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + "\n"); }
  process.exitCode = report.passed ? 0 : 2;
}

// Across-track rollback regression. Active hazards advance through original
// game ticks; this does not claim every hazard has physically hit a driver.
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { runPowerupCase } from "./online-v2-powerups-probe.mjs";

const report = { scope: "Two predicted clients and authority; 420 ticks per VS track, active world/hazard observations and delayed corrections.", passed: true, tracks: [] };
for (let track = 0; track < 18; track++) {
  const result = await runPowerupCase({ track, scenario: 0, juiced: 0 });
  report.tracks.push(result); report.passed &&= result.passed;
  console.log(JSON.stringify({ track, passed: result.passed, error: result.error }));
}
if (process.argv[2]) { const path = resolve(process.argv[2]); await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify(report, null, 2) + "\n"); }
process.exitCode = report.passed ? 0 : 2;

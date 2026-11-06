// Real graphical regression for local camera ownership and distant racer LOD.
// Requires both production and private browser/headless builds plus Playwright.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runBrowserProbe } from "./online-v2-browser-probe.mjs";

const output = resolve(process.argv[2] || ".cache/online-v2/cameras.json");
const base = output.replace(/\.json$/i, "");
const delayed = { inputDelayMs: 50, frameDelayMs: 70, jitterMs: 15, dropEvery: 31 };
const cases = [
  { name: "two-player-prediction", frames: 300, ...delayed },
  { name: "distant-racer", frames: 180, ...delayed, fixture: { scenario: 108, juiced: 0 },
    root: fileURLToPath(new URL("../build-web-probe/", import.meta.url)),
    engine: fileURLToPath(new URL("../build-online-v2-probe/ctr_native.cjs", import.meta.url)) },
  { name: "four-player-cameras", players: 4, frames: 150, prediction: false },
];
const report = { passed: true, cases: [] };
for (const { name, ...options } of cases) {
  const result = await runBrowserProbe({ ...options, output: base + "-" + name + ".json" });
  report.cases.push({ name, ...result }); report.passed &&= result.passed;
  console.log(JSON.stringify({ name, passed: result.passed, errors: result.errors,
    views: result.clients.map(client => client?.view), timing: result.clients.map(client => client?.timing) }));
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
process.exitCode = report.passed ? 0 : 2;

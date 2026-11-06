// Optional end-to-end probe. Install Playwright separately and set
// CTR_PLAYWRIGHT_MODULE to its index.mjs path when it is outside web/node_modules.
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLobbyServer } from "./server.mjs";
import { racePad } from "./online-v2-race-tape.mjs";
import { createNetworkProxy } from "./online-v2-network-proxy.mjs";
import { decodeFrame } from "./online-v2-protocol.mjs";
import { SimulationWorker } from "./online-v2-simulation.mjs";
import { weaponPad, powerupCoverage, coveredPowerup } from "./online-v2-powerups-probe.mjs";
import { inspectRaceScene } from "./online-v2-visual-check.mjs";

export async function runBrowserProbe({ frames = 300, output, prediction = true,
  fixture, track = 0, players = 2, root, engine,
  inputDelayMs = 0, frameDelayMs = 0, jitterMs = 0, dropEvery = 0, executablePath = process.env.CTR_CHROME,
  playwrightModule = process.env.CTR_PLAYWRIGHT_MODULE || "playwright" } = {}) {
  const { chromium } = await import(playwrightModule);
  const inputEvents = [], inputCounts = {};
  const app = createLobbyServer({ root, iceServers: [], onlineV2: { fixture, simulationFactory: () => new SimulationWorker({ engine }), observeInput: event => {
    inputCounts[event.status] = (inputCounts[event.status] || 0) + 1;
    if (inputEvents.length < 50) inputEvents.push(event);
  } } });
  await new Promise(resolveListen => app.server.listen(0, "127.0.0.1", resolveListen));
  const proxy = await createNetworkProxy({ targetPort: app.server.address().port, inputDelayMs, frameDelayMs, jitterMs });
  const origin = "http://127.0.0.1:" + proxy.port;
  let browser;
  const pages = [];
  const readClient = page => page.evaluate(() => {
    const timing = values => {
      const sorted = [...values].sort((a, b) => a - b);
      return { samples: sorted.length, p95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] || 0, maxMs: sorted.at(-1) || 0 };
    };
    const { predictionTimes, reconciliationTimes, ...status } = window.probeStatus;
    return { ...status, timing: { inputToPrediction: timing(predictionTimes), reconciliation: timing(reconciliationTimes) },
    stats: window.probe.prediction ? { ...window.probe.prediction.stats } : undefined,
    confirmedTick: window.probe.prediction?.confirmedTick,
    predictedTick: window.probe.simulation?.tick,
    view: window.probe.simulation?.view,
    latency: { ...window.probe.latency, predictionLead: window.probe.latency.predictionLead },
  }; }).catch(() => null);
  const report = { scope: "Node/WASM authority with " + players + " Chromium/WebGL2 clients; original game, camera ownership, prediction/correction and diagnostic observations.",
    frames, prediction, fixture, track, players, network: { inputDelayMs, frameDelayMs, jitterMs, dropEvery },
    passed: false, clients: [], errors: [], diagnostics: [], inputEvents, inputCounts, wireFrameBytes: 0, wireFrames: 0 };
  const powerupStates = [[], []]; let baselines = [];
  app.server.on("upgrade", request => report.diagnostics.push({ path: request.url, origin: request.headers.origin }));
  try {
    browser = await chromium.launch({ executablePath, headless: true,
      args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required",
        "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
    for (let i = 0; i < players; i++) {
      const context = await browser.newContext();
      await context.addInitScript(dropEvery => {
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function(data) {
          const packet = JSON.parse(data);
          if (packet.type === "input") {
            this.probeInputs = (this.probeInputs || 0) + 1;
            if (dropEvery && this.probeInputs % dropEvery === 0) return;
          }
          return send.call(this, data);
        };
      }, dropEvery);
      const page = await context.newPage();
      page.on("websocket", socket => {
        let latestTick;
        let sent = 0;
        socket.on("framereceived", ({ payload }) => {
          try {
            const packet = typeof payload === "string" ? JSON.parse(payload) : decodeFrame(payload);
            if (packet.type === "session") baselines[i] = packet.state;
            if (packet.type === "frame") {
              latestTick = packet.tick; report.wireFrameBytes += payload.length; report.wireFrames++;
              if (fixture) powerupStates[i] = powerupCoverage(packet.state, baselines[i], powerupStates[i].inventoryChanges === undefined ? undefined : powerupStates[i]);
            }
          } catch (error) { report.errors.push({ client: i, message: error.message }); }
        });
        socket.on("framesent", ({ payload }) => {
          try {
            const packet = JSON.parse(payload);
            if (packet.type === "input" && sent++ < 12) report.diagnostics.push({ client: i, inputTick: packet.tick, latestAuthorityTick: latestTick });
          } catch {}
        });
      });
      page.on("pageerror", error => report.errors.push({ client: i, message: error.message }));
      page.on("console", message => {
        if (message.type() === "error" && report.diagnostics.length < 30) report.diagnostics.push({ client: i, message: message.text() });
      });
      // Keep the launcher's real loopback origin while replacing its controller
      // with the feasibility client. Each tab owns exactly one game runtime.
      await page.route(origin + "/app.js", route => route.fulfill({ contentType: "text/javascript", body: "" }));
      await page.goto(origin);
      await page.addScriptTag({ url: origin + "/ctr_native.js" });
      await page.locator("#disc").setInputFiles(fileURLToPath(new URL("../assets/ctr-u.bin", import.meta.url)));
      const tape = Array.from({ length: frames + 1000 }, (_, index) => [0, 1].map(slot => fixture ? weaponPad(index, slot, fixture.scenario) : racePad(index, slot)));
      await page.evaluate(async ({ tape, fixture }) => {
        const { OnlineV2Client } = await import("/online-v2-client.js");
        window.probeStatus = { events: [], frames: 0, predictions: 0, predictionsBeforeFirstFrame: 0, corrections: 0, missingInputs: 0, ownMissingInputs: 0,
          predictionTimes: [], reconciliationTimes: [],
          farRacer: { beyondCutoffFrames: 0, visibleFrames: 0, spriteFrames: 0 },
          coverage: { movingFrames: 0, driftFrames: 0, boostFrames: 0, airborneFrames: 0, kartCollisionFrames: 0 } };
        window.probe = new OnlineV2Client({ createModule: window.createCTRModule,
          disc: document.getElementById("disc").files[0], canvas: document.getElementById("canvas"),
          getInput: ({ tick, slot } = {}) => {
            const index = tick === undefined ? 0 : Math.max(0, tick - window.probeStatus.loaded.tick);
            return tape[index % tape.length][slot || 0];
          },
          onStatus(message) {
            if (message.type === "prediction") {
              window.probeStatus.predictionTimes.push(message.inputToPredictionMs);
              window.probeStatus.predictions++;
              if (!window.probeStatus.frames) window.probeStatus.predictionsBeforeFirstFrame++;
            } else if (message.type === "reconciliation") {
              window.probeStatus.reconciliationTimes.push(message.milliseconds);
            } else if (message.type === "correction") {
              window.probeStatus.corrections++; window.probeStatus.stats = message.stats;
            } else if (message.type === "frame") {
              if (fixture?.scenario === 108) {
                const read = window.probe.simulation.module._CTR_OnlineTestRacerView;
                const far = window.probeStatus.farRacer;
                far.last = { visible: read(0, 1, 0), distance: read(0, 1, 1), cutoff: read(0, 1, 2), sprite: read(0, 1, 3), lod: read(0, 1, 4) };
                if (far.last.distance > far.last.cutoff) {
                  far.beyondCutoffFrames++; if (far.last.visible) far.visibleFrames++; if (far.last.sprite) far.spriteFrames++;
                }
              }
              window.probeStatus.frames++;
              window.probeStatus.missingInputs += message.missingInputs?.filter(Boolean).length || 0;
              if (message.missingInputs?.[window.probe.slot]) window.probeStatus.ownMissingInputs++;
              const view = new DataView(Uint8Array.from(message.state).buffer);
              const coverage = { movingFrames: false, driftFrames: false, boostFrames: false, airborneFrames: false, kartCollisionFrames: false };
              for (let slot = 0; slot < 2; slot++) {
                const base = (16 + slot * 24) * 4;
                const actions = view.getUint32(base + 40, true);
                coverage.movingFrames ||= view.getInt32(base + 28, true) !== 0;
                coverage.driftFrames ||= view.getUint32(base + 36, true) === 2;
                coverage.boostFrames ||= view.getInt32(base + 32, true) > 0;
                coverage.airborneFrames ||= (actions & 0x80400) !== 0;
                coverage.kartCollisionFrames ||= (actions & 0x10000000) !== 0;
              }
              for (const key of Object.keys(coverage)) if (coverage[key]) window.probeStatus.coverage[key]++;
            }
            else {
              window.probeStatus.events.push(message);
              if (message.type === "players") window.probeStatus.players = message.players;
              if (message.type === "loaded") window.probeStatus.loaded = message;
              if (message.type === "closed") window.probeStatus.closed = message;
            }
          },
        });
      }, { tape, fixture });
      pages.push(page);
    }
    await pages[0].evaluate(({ prediction, track, players }) => window.probe.create({ prediction, track, players }), { prediction, track, players });
    await pages[0].waitForFunction(() => window.probeStatus.loaded || window.probeStatus.closed, { timeout: 60000 });
    const first = await pages[0].evaluate(() => window.probeStatus);
    if (first.closed) throw new Error(first.closed.reason);
    for (let slot = 1; slot < players; slot++) await pages[slot].evaluate(code => window.probe.join(code), first.loaded.code);
    await pages[0].waitForFunction(count => window.probeStatus.players?.length === count && window.probeStatus.players.every(player => player.ready) || window.probeStatus.closed, players, { timeout: 60000 });
    const raceStarted = performance.now();
    await pages[0].evaluate(() => window.probe.start());
    await Promise.all(pages.map(page => page.waitForFunction(count => window.probeStatus.frames >= count || window.probeStatus.closed, frames, { timeout: 60000 })));
    report.raceMs = performance.now() - raceStarted;
    report.clients = await Promise.all(pages.map(readClient));
    report.scenes = await Promise.all(pages.map(inspectRaceScene));
    if (fixture) report.powerups = powerupStates;
    report.passed = report.errors.length === 0 && report.scenes.every(scene => scene.visible) && report.clients.every((client, slot) => !client.closed && client.frames >= frames &&
      client.view?.slot === slot && client.view.width === 512 && client.view.height === 216 && client.view.renderedMask === 1 << slot &&
      client.view.minimap.available && client.view.minimap.right > 20 && client.view.minimap.right < 256 && client.view.minimap.bottom === 160 &&
      (fixture || client.coverage.movingFrames > 0) &&
      (!prediction || client.ownMissingInputs < client.frames / 10) &&
      (!prediction || client.predictionsBeforeFirstFrame > 0) &&
      !client.events.some(event => event.type === "divergence" || event.type === "error"));
    if (prediction && inputDelayMs + frameDelayMs > 0 && fixture?.scenario !== 108) report.passed &&= report.clients.every(client => client.corrections > 0);
    if (fixture?.scenario === 108) report.passed &&= report.clients.every(client => client.farRacer.beyondCutoffFrames >= frames / 2 &&
      client.farRacer.visibleFrames === client.farRacer.beyondCutoffFrames && client.farRacer.spriteFrames === 0);
    else if (fixture) report.passed &&= powerupStates.every(coverage => coveredPowerup(fixture.scenario, coverage));
    // Development-machine budgets. These are software timings, not a measure
    // of display scanout, controller polling or input-to-photon latency.
    report.latencyPassed = !prediction || report.clients.every(client => client.timing.inputToPrediction.samples > 0 &&
      client.timing.reconciliation.samples > 0 && client.timing.inputToPrediction.p95Ms < 33.44 &&
      client.timing.reconciliation.p95Ms < 33.44 && client.timing.reconciliation.maxMs < 66.88);
    report.passed &&= report.latencyPassed;
    if (output) {
      await mkdir(dirname(resolve(output)), { recursive: true });
      for (let slot = 0; slot < players; slot++) await pages[slot].locator("#canvas").screenshot({
        path: resolve(output).replace(/\.json$/i, "") + "-player" + (slot + 1) + ".png",
      });
    }
  } catch (error) {
    report.errors.push({ message: error.message });
    report.clients = await Promise.all(pages.map(readClient));
  }
  finally {
    await browser?.close(); await proxy.close(); await app.close();
    if (output) { await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), JSON.stringify(report, null, 2) + "\n"); }
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const delayed = process.argv.includes("--delayed");
    const fixtureArg = process.argv.find(arg => arg.startsWith("--fixture="));
    const fixture = fixtureArg ? { scenario: Number(fixtureArg.split("=")[1]), juiced: process.argv.includes("--juiced") ? 1 : 0 } : undefined;
    const playersArg = process.argv.find(arg => arg.startsWith("--players="));
    const report = await runBrowserProbe({ output: process.argv[2], prediction: !process.argv.includes("--confirmed"),
      ...(playersArg ? { players: Number(playersArg.split("=")[1]) } : {}),
      ...(fixture ? { fixture, frames: fixture.scenario === 108 ? 180 : 420, root: fileURLToPath(new URL("../build-web-probe/", import.meta.url)),
        engine: fileURLToPath(new URL("../build-online-v2-probe/ctr_native.cjs", import.meta.url)) } : {}),
      ...(delayed ? { inputDelayMs: 50, frameDelayMs: 70, jitterMs: 15, dropEvery: 31 } : {}) });
    console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

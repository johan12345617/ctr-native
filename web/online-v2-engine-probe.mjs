// Real keyboard-driven engine lobby and original multiplayer menu flow.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLobbyServer } from "./server.mjs";
import { SimulationWorker } from "./online-v2-simulation.mjs";
import { createNetworkProxy } from "./online-v2-network-proxy.mjs";
import { inspectRaceScene } from "./online-v2-visual-check.mjs";
import { decodeFrame } from "./online-v2-protocol.mjs";
const { chromium } = await import(process.env.CTR_PLAYWRIGHT_MODULE || "playwright");
const output = resolve(process.argv[2] || ".cache/online-v2/engine-menu.json");
const mode = process.argv[3] || "race", modeRow = { race: 0, cup: 1, battle: 2 }[mode];
const base = output.replace(/\.json$/i, "");
await mkdir(dirname(output), { recursive: true });
const transitions = process.argv.includes("--transitions");
const manualDisc = process.argv.includes("--manual-disc");
const slowGuest = process.argv.includes("--slow-guest");
const gamepads = process.argv.includes("--gamepads");
const padProfiles = ["xbox", "ds4", "dualsense", "ds4-raw", "dualsense-raw"];
const inputCounts = [{}, {}];
const observeInput = ({ slot, status }) => { inputCounts[slot][status] = (inputCounts[slot][status] || 0) + 1; };
const app = createLobbyServer({ iceServers: [], ...(manualDisc ? { localDisc: null } : {}), ...(transitions ? {
  root: fileURLToPath(new URL("../build-web-probe/", import.meta.url)),
  onlineV2: { observeInput, fixture: { scenario: 109, juiced: 0 }, simulationFactory: () => new SimulationWorker({
    engine: fileURLToPath(new URL("../build-online-v2-probe/ctr_native.cjs", import.meta.url)) }) },
} : { onlineV2: { observeInput } }) });
await new Promise(resolve => app.server.listen(0, "127.0.0.1", resolve));
const proxy = await createNetworkProxy({ targetPort: app.server.address().port, inputDelayMs: 30, frameDelayMs: 40, jitterMs: 5 });
const origin = "http://127.0.0.1:" + proxy.port;
const guestProxy = slowGuest ? await createNetworkProxy({ targetPort: app.server.address().port, inputDelayMs: 200, frameDelayMs: 220, jitterMs: 25 }) : undefined;
const report = { passed: false, mode, slowGuest, gamepads, inputCounts, drivingInputFrames: [0, 0], checks: [], errors: [], diagnostics: [], events: [] };
let browser, driving = false, latestPads = []; const pages = [];
const info = (page, field) => page.evaluate(field => window.ctrEngine?.module?._CTR_WebMenuInfo(field), field);
async function waitInfo(page, field, value, timeout = 60000) {
  await page.waitForFunction(({ field, value }) => window.ctrEngine?.module?._CTR_WebMenuInfo(field) === value, { field, value }, { timeout });
}
async function padKey(page, key, down) { await page.evaluate(({ key, down }) => window.probePadKey(key, down), { key, down }); }
async function press(page, key) {
  if (gamepads) {
    await padKey(page, key, true); await page.waitForTimeout(90); await padKey(page, key, false);
  } else { await page.locator("#canvas").focus(); await page.keyboard.press(key, { delay: 90 }); }
  await page.waitForTimeout(160);
}
async function waitGuestControl(buttons) {
  const deadline = Date.now() + 6000;
  while ((latestPads[1]?.buttons & 0x4000) !== buttons && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(latestPads[1]?.buttons & 0x4000, buttons);
}
try {
  browser = await chromium.launch({ executablePath: process.env.CTR_CHROME, headless: true,
    args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required", "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
  for (let i = 0; i < 2; i++) {
    const clientOrigin = i === 1 && guestProxy ? "http://127.0.0.1:" + guestProxy.port : origin;
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 1000 } })).newPage(); pages.push(page);
    if (gamepads) await page.addInitScript(() => {
      window.probePads = [];
      window.probeConnectPad = (profile, index = 0) => {
        const raw = profile.endsWith("-raw");
        const id = profile === "xbox" ? "Xbox 360 Controller (XInput STANDARD GAMEPAD)"
          : "Wireless Controller (Vendor: 054c Product: " + (profile.startsWith("ds4") ? "09cc" : "0ce6") + ")";
        const axes = Array(raw ? 10 : 4).fill(0);
        if (raw) { axes[3] = axes[4] = -1; axes[9] = 3.2857; }
        window.probePads[index] = { id, index, connected: true, mapping: raw ? "" : "standard", axes,
          buttons: Array.from({ length: raw ? 14 : 17 }, () => ({ pressed: false, value: 0 })), timestamp: performance.now() };
        window.probePadIndex = index;
      };
      window.probePadKey = (key, down) => {
        const pad = window.probePads[window.probePadIndex];
        const raw = pad.mapping !== "standard";
        if (key.startsWith("Arrow")) {
          const axis = key === "ArrowLeft" || key === "ArrowRight" ? 0 : 1;
          pad.axes[axis] = down ? (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1) : 0;
        } else {
          const button = { c: raw ? 1 : 0, v: raw ? 2 : 1, Enter: 9 }[key];
          if (button === undefined) throw new Error("Unmapped probe key: " + key);
          pad.buttons[button] = { pressed: down, value: down ? 1 : 0 };
        }
        pad.timestamp = performance.now();
      };
      Object.defineProperty(navigator, "getGamepads", { value: () => window.probePads });
    });
    page.on("pageerror", error => report.errors.push({ slot: i, message: error.message }));
    page.on("websocket", socket => socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") {
        if (i === 0) {
          latestPads = decodeFrame(payload).pads;
          if (driving) latestPads.forEach((pad, slot) => { if (pad.buttons & 0x4000) report.drivingInputFrames[slot]++; });
        }
        return;
      }
      const { type, reason, message, slot, tick } = JSON.parse(payload);
      if (type !== "pong" && report.events.length < 80) report.events.push({ peer: i, type, reason, message, slot, tick });
    }));
    page.on("console", message => { if (message.type() === "error") report.diagnostics.push({ slot: i, message: message.text() }); });
    await page.goto(clientOrigin);
    if (manualDisc) {
      await page.waitForFunction(() => !!window.ctrEngine);
      assert.equal((await page.request.get(clientOrigin + "/local-disc")).status(), 404);
      if (!gamepads) {
        await page.locator("#mode-race").click();
        await page.waitForFunction(() => document.getElementById("status").textContent.includes("Choose your game disc"));
      }
      assert.ok(await page.locator("#start").isVisible(), "Online must retain Start game before choosing a disc.");
      assert.ok(await page.locator("#start").isDisabled());
      if (i === 0) {
        await page.locator("#disc").setInputFiles({ name: "invalid.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(17 * 2352) });
        await page.waitForFunction(() => document.getElementById("status").textContent.includes("not a supported raw disc"));
        assert.ok(await page.locator("#start").isDisabled(), "An invalid disc must not enable Start game.");
      }
      await page.locator("#disc").setInputFiles(fileURLToPath(new URL("../assets/ctr-u.bin", import.meta.url)));
    }
    await page.waitForFunction(() => !document.getElementById("start").disabled, undefined, { timeout: 60000 });
    assert.match(await page.locator("#status").innerText(), /ctr-u.bin.*ready/i);
    assert.ok(await page.locator("#start").isVisible());
    if (manualDisc && i === 0) await page.screenshot({ path: base + "-manual-ready.png", fullPage: true });
    await page.locator("#start").click();
    if (manualDisc && !gamepads) await waitInfo(page, 3, 1);
    else {
      await waitInfo(page, 12, 1);
      if (gamepads) {
        for (const profile of padProfiles) {
          await page.evaluate(profile => { window.probePads = []; window.probeConnectPad(profile); }, profile);
          await page.locator("#fullscreen").focus();
          await press(page, "ArrowDown"); await waitInfo(page, 8, 1);
          assert.equal(await page.locator("#canvas").evaluate(canvas => document.activeElement === canvas), true);
          await press(page, "ArrowUp"); await waitInfo(page, 8, 0);
        }
      }
      const onlineRow = await info(page, 14);
      for (let row = 0; row < onlineRow; row++) await press(page, "ArrowDown");
      assert.equal(await info(page, 8), onlineRow);
      await press(page, "c"); await waitInfo(page, 3, 1);
    }
  }
  report.checks.push(manualDisc
    ? gamepads ? "Both clients manually select their disc and reach the native lobby through controller-operated local menus."
      : "With auto-loading unavailable, Online keeps Start game visible; invalid discs remain blocked and manually selected discs open the native lobby on both clients."
    : "Both clients auto-load the checkout disc and open Online from the engine main menu.");
  if (gamepads) report.checks.push("Xbox, DualShock 4, DualSense and raw Sony layouts hot-plug into both local engine menus; sticks navigate and automatically focus the game.");
  await pages[0].locator("#canvas").screenshot({ path: base + "-lobby.png" });
  await press(pages[0], "c"); await waitInfo(pages[0], 5, 3);
  const code = (await info(pages[0], 6)).toString(16).padStart(6, "0");
  await press(pages[1], "ArrowDown"); await press(pages[1], "c"); await waitInfo(pages[1], 4, 1);
  await pages[1].keyboard.type(code, { delay: 90 });
  await pages[1].locator("#canvas").screenshot({ path: base + "-join.png" });
  await press(pages[1], "Enter");
  await waitInfo(pages[0], 15, 3);
  await pages[0].locator("#canvas").screenshot({ path: base + "-waiting.png" });
  report.checks.push("Native Create/Join and typed room code reach a two-player ready room.");
  await press(pages[0], "Enter");
  await Promise.all(pages.map(page => page.waitForFunction(() => window.ctrEngine?.module?._CTR_OnlineTick?.() > 40, undefined, { timeout: 60000 })));
  await waitInfo(pages[0], 12, 1);
  report.checks.push("Both peers enter the synchronized original engine menu.");
  for (let i = 0; i < modeRow; i++) await press(pages[0], "ArrowDown");
  await press(pages[0], "c"); await waitInfo(pages[0], 7, 1); await waitInfo(pages[0], 16, 1);
  assert.equal(await info(pages[0], 13), 2);
  const firstCharacter = await info(pages[0], 17);
  for (const [profileIndex, profile] of (gamepads ? padProfiles : [null]).entries()) {
    if (gamepads) await pages[1].evaluate(profile => {
      window.probePads = []; window.probeConnectPad("xbox", 0); window.probeConnectPad(profile, 2);
    }, profile);
    const secondCharacter = await info(pages[0], 18);
    await press(pages[1], profileIndex % 2 ? "ArrowLeft" : "ArrowRight");
    await pages[0].waitForFunction(character => window.ctrEngine.module._CTR_WebMenuInfo(18) !== character, secondCharacter);
  }
  assert.equal(await info(pages[0], 17), firstCharacter);
  await press(pages[0], "c"); await press(pages[1], "c");
  const destination = mode === "cup" ? 3 : 2;
  await waitInfo(pages[0], 7, destination);
  report.checks.push("Host chooses " + mode + "; each peer owns its character; original selection flow opens.");
  await waitInfo(pages[0], mode === "cup" ? 20 : 19, 1);
  await pages[0].locator("#canvas").screenshot({ path: base + "-selection.png" });
  await press(pages[0], "c");
  if (mode === "battle") {
    await waitInfo(pages[0], 7, 4); await waitInfo(pages[0], 21, 1);
    for (let attempt = 0; attempt < 8; attempt++) {
      const highlighted = await info(pages[0], 31);
      if (highlighted === 2) break;
      await press(pages[0], highlighted > 2 ? "ArrowUp" : "ArrowDown");
    }
    await waitInfo(pages[0], 31, 2);
    const hostTeam = await info(pages[0], 32), guestTeam = await info(pages[0], 33);
    await press(pages[1], "ArrowRight");
    await pages[0].waitForFunction(team => window.ctrEngine.module._CTR_WebMenuInfo(33) !== team, guestTeam);
    assert.equal(await info(pages[0], 32), hostTeam);
    for (let row = 0; row < 7; row++) await press(pages[0], "ArrowDown");
    await pages[0].locator("#canvas").screenshot({ path: base + "-battle-settings.png" });
    await press(pages[0], "c");
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    if (await pages[0].evaluate(() => window.ctrEngine.module?._CTR_OnlineCanPredict?.() === 1)) break;
    await pages[0].waitForTimeout(800);
    await press(pages[0], "c");
  }
  await Promise.all(pages.map(page => page.waitForFunction(() => window.ctrEngine?.module?._CTR_OnlineCanPredict?.() === 1, undefined, { timeout: 60000 })));
  const tick = await pages[0].evaluate(() => window.ctrEngine.module._CTR_OnlineTick());
  driving = true;
  if (gamepads) { await padKey(pages[0], "c", true); await padKey(pages[1], "c", true); }
  else { await pages[0].keyboard.down("c"); await pages[1].keyboard.down("c"); }
  await pages[0].waitForFunction(tick => window.ctrEngine.module._CTR_OnlineTick() >= tick + 150, tick, { timeout: 30000 });
  if (gamepads) { await padKey(pages[0], "c", false); await padKey(pages[1], "c", false); }
  else { await pages[0].keyboard.up("c"); await pages[1].keyboard.up("c"); }
  driving = false;
  assert.ok(report.drivingInputFrames.every(frames => frames > 60), "Authority must receive sustained driving controls from both players.");
  if (gamepads) {
    await padKey(pages[1], "c", true); await waitGuestControl(0x4000);
    await pages[1].evaluate(() => { window.probePads = []; });
    await waitGuestControl(0);
    await pages[1].evaluate(() => { window.probeConnectPad("dualsense", 3); });
    await padKey(pages[1], "c", true); await waitGuestControl(0x4000);
    await padKey(pages[1], "c", false); await waitGuestControl(0);
    report.checks.push("Unplugging the guest's held controller releases acceleration; reconnecting a DualSense at a different browser index resumes control without reloading.");
  }
  report.scenes = await Promise.all(pages.map(inspectRaceScene));
  assert.ok(report.scenes.every(scene => scene.visible), "Both players must see original track/arena geometry.");
  report.levels = await Promise.all(pages.map(page => info(page, 2)));
  if (mode === "battle") assert.ok(report.levels.every(level => level >= 18 && level < 25));
  else assert.ok(report.levels.every(level => level >= 0 && level < 18));
  report.checks.push("Original " + mode + " loading, individual cameras and driving prediction run on both clients.");
  for (const [slot, page] of pages.entries()) await page.locator("#canvas").screenshot({ path: base + "-player" + (slot + 1) + ".png" });
  await pages[0].locator("#fullscreen").click();
  await pages[0].waitForFunction(() => !!document.fullscreenElement);
  await press(pages[0], "Enter");
  await pages[0].waitForFunction(() => window.ctrEngine.module._CTR_OnlineCanPredict() === 0);
  // Preserve the original pause menu's intentional unpause cooldown.
  await pages[0].waitForTimeout(1000);
  await press(pages[0], "Enter");
  await pages[0].waitForFunction(() => window.ctrEngine.module._CTR_OnlineCanPredict() === 1);
  await pages[0].keyboard.press("Escape");
  report.checks.push("Engine menus remain usable in fullscreen and pause safely suspends prediction.");
  if (transitions) {
    await waitInfo(pages[0], 26, 1);
    await pages[0].waitForTimeout(1500);
    for (const [slot, page] of pages.entries()) await page.locator("#canvas").screenshot({ path: base + "-results-player" + (slot + 1) + ".png" });
    for (let attempt = 0; attempt < 30; attempt++) {
      if (mode === "cup" ? await info(pages[0], 11) === 1 : await info(pages[0], 25) >= 0) break;
      await press(pages[0], "c"); await press(pages[1], "c");
      await pages[0].waitForTimeout(500);
      if (mode === "cup" ? await info(pages[0], 11) === 1 : await info(pages[0], 25) >= 0) break;
    }
    if (mode === "cup") assert.equal(await info(pages[0], 11), 1);
    else {
      assert.ok(await info(pages[0], 25) >= 0);
      for (let row = 0; row < (mode === "battle" ? 4 : 3); row++) await press(pages[0], "ArrowDown");
      await press(pages[0], "c"); await waitInfo(pages[0], 2, 39); await waitInfo(pages[0], 12, 1);
      const currentRow = await info(pages[0], 8);
      for (let row = currentRow; row < 3; row++) await press(pages[0], "ArrowDown");
      await press(pages[0], "c");
      await Promise.all(pages.map(page => page.waitForFunction(() => window.ctrEngine?.online === false)));
      await waitInfo(pages[0], 3, 1); await waitInfo(pages[0], 5, 0);
      await press(pages[0], "c"); await waitInfo(pages[0], 5, 3);
      await press(pages[0], "v"); await waitInfo(pages[0], 5, 0);
    }
    if (mode === "cup") await Promise.all(pages.map(page => page.waitForFunction(() => window.ctrEngine?.module?._CTR_OnlineCanPredict() === 1, undefined, { timeout: 60000 })));
    report.checks.push("Original results and " + (mode === "cup" ? "next cup track resumes prediction" : "quit/leave/recreate/cancel remain usable") + " on both peers.");
  }
  report.passed = report.errors.length === 0;
} catch (error) {
  report.errors.push({ message: error.message });
  for (const [slot, page] of pages.entries()) {
    report.diagnostics.push(await page.evaluate(() => ({ status: document.getElementById("status").textContent,
      online: window.ctrEngine?.online, info: Array.from({ length: 26 }, (_, field) => window.ctrEngine?.module?._CTR_WebMenuInfo(field)) })).catch(() => null));
    await page.screenshot({ path: base + "-failure-" + slot + ".png", fullPage: true }).catch(() => {});
  }
} finally { await browser?.close(); await guestProxy?.close(); await proxy.close(); await app.close(); await writeFile(output, JSON.stringify(report, null, 2) + "\n"); }
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 2;

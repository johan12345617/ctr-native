import test from "node:test";
import assert from "node:assert/strict";
import { readInput, readGamepad, gamepadProfile, BrowserGamepads, validInput, axisByte } from "../input.js";

const buttons = (count, down = []) => Array.from({ length: count }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 }));
const standardPad = (id, index = 0, down = []) => ({ id, index, connected: true, mapping: "standard", buttons: buttons(17, down), axes: [0, 0, 0, 0] });

test("keyboard and standard gamepad state preserve PSX masks and axis order", () => {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false, value: 0 }));
  buttons[5].pressed = true;
  const input = readInput(new Set(["KeyC", "ArrowRight"]), [{ connected: true, mapping: "standard", buttons, axes: [-1, 1, 0, 0.05] }]);
  assert.equal(input.buttons, 0x4820);
  assert.deepEqual(input.axes, [128, 128, 0, 255]);
  assert.deepEqual(readInput(new Set(["KeyC"]), [], true), { buttons: 0, axes: [128, 128, 128, 128] });
  assert.equal(axisByte(NaN), 128);
  assert.equal(axisByte(4), 255);
  assert.equal(axisByte(-4), 0);
});

test("Xbox/XInput, DualShock 4 and DualSense automatically use standard physical button positions", () => {
  const masks = [0x4000, 0x2000, 0x8000, 0x1000, 0x400, 0x800, 0x100, 0x200, 1, 8, 2, 4, 0x10, 0x40, 0x80, 0x20];
  for (const id of ["Xbox 360 Controller (XInput STANDARD GAMEPAD)", "Xbox Wireless Controller", "Wireless Controller (Vendor: 054c Product: 09cc)", "DualSense Wireless Controller (Vendor: 054c Product: 0ce6)"]) {
    for (let button = 0; button < masks.length; button++) {
      const pad = standardPad(id, 0, [button]);
      assert.equal(readGamepad(pad).buttons, masks[button], id + " button " + button);
    }
  }
});

test("known raw Sony HID layouts map faces, triggers, both sticks and eight-way hat automatically", () => {
  for (const product of ["05c4", "09cc", "0ba0", "0ce6", "0df2"]) {
    const pad = { id: "Wireless Controller (Vendor: 054c Product: " + product + ")", connected: true, mapping: "", buttons: buttons(14, [1, 4, 8, 9]), axes: [-1, .5, 1, -1, 1, -.5, 0, 0, 0, 3.2857] };
    assert.equal(gamepadProfile(pad), "sony-hid");
    assert.deepEqual(readGamepad(pad), { buttons: 0x4609, axes: [255, 64, 0, 191] });
    pad.buttons = buttons(14);
    pad.axes[4] = -1;
    const directions = [0x10, 0x30, 0x20, 0x60, 0x40, 0xc0, 0x80, 0x90];
    for (let direction = 0; direction < 8; direction++) {
      pad.axes[9] = -1 + direction * 2 / 7;
      assert.equal(readGamepad(pad).buttons, directions[direction]);
    }
    pad.axes[9] = 3.2857; assert.equal(readGamepad(pad).buttons, 0);
    pad.axes[9] = NaN; assert.equal(readGamepad(pad).buttons, 0);
  }
  assert.equal(gamepadProfile({ ...standardPad("054c-05c4-Wireless Controller"), mapping: "", buttons: buttons(14), axes: Array(10).fill(0) }), "sony-hid");
  assert.equal(readGamepad({ ...standardPad("Unknown wheel"), mapping: "" }), undefined);
});

test("last-used controller takes over online while local slots survive hot-plug gaps", () => {
  const reader = new BrowserGamepads();
  const xbox = standardPad("Xbox", 2), sony = standardPad("DualSense", 5, [0]);
  assert.equal(reader.read([], [xbox, null, sony]).buttons, 0x4000);
  assert.equal(reader.selectedIndex, 5);
  assert.deepEqual(reader.slots, [2, 5, null, null]);
  sony.buttons = buttons(17);
  assert.equal(reader.read([], [xbox, sony]).buttons, 0);
  assert.equal(reader.selectedIndex, 5);
  xbox.buttons = buttons(17, [1]);
  assert.equal(reader.read([], [xbox, sony]).buttons, 0x2000);
  assert.equal(reader.selectedIndex, 2);
  reader.poll([sony]);
  assert.deepEqual(reader.slots, [null, 5, null, null]);
  assert.equal(reader.selectedIndex, 5);
  const ds4 = standardPad("DualShock 4", 0);
  reader.poll([ds4, sony]); assert.deepEqual(reader.slots, [0, 5, null, null]);
  assert.deepEqual(reader.read(new Set(["KeyC"]), [ds4, sony], true), { buttons: 0, axes: [128, 128, 128, 128] });
  reader.poll([]); assert.deepEqual(reader.slots, [null, null, null, null]);
});

test("standard mapping wins over brand detection; XInput fallback and malformed axes stay safe", () => {
  const pad = standardPad("DualSense", 0, [0]); pad.axes = [.04, -.03, NaN, 9];
  assert.deepEqual(readGamepad(pad), { buttons: 0x4000, axes: [128, 255, 128, 128] });
  const xinput = { ...standardPad("XInput Controller", 0, [2]), mapping: "" };
  assert.equal(readGamepad(xinput).buttons, 0x8000);
  assert.equal(readGamepad({ ...pad, connected: false }), undefined);
});

test("browser rumble is bounded, stops cleanly and tolerates unsupported actuators", t => {
  const effects = [], resets = [];
  const pad = standardPad("DualSense");
  pad.vibrationActuator = { playEffect: (...args) => { effects.push(args); return Promise.resolve(); }, reset: () => { resets.push(true); return Promise.resolve(); } };
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { getGamepads: () => [pad] } });
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else delete globalThis.document;
    if (oldNavigator) Object.defineProperty(globalThis, "navigator", oldNavigator); else delete globalThis.navigator;
  });
  const reader = new BrowserGamepads(); reader.poll([pad]);
  reader.rumble(0, 65535, 32767, 0); reader.rumble(0, 65535, 32767, 50);
  assert.equal(effects.length, 1);
  assert.equal(effects[0][0], "dual-rumble");
  assert.equal(effects[0][1].duration, 200); assert.equal(effects[0][1].strongMagnitude, 1);
  reader.rumble(undefined, 65535, 32767, 101); assert.equal(effects.length, 2);
  reader.rumble(0, 0, 0, 110); reader.rumble(0, 0, 0, 120); assert.equal(resets.length, 1);
  delete pad.vibrationActuator; assert.doesNotThrow(() => reader.rumble(0, 1, 1, 130));
});
test("input validation rejects malformed, oversized and non-integral values", () => {
  const input = { type: "input", seq: 1, buttons: 0x4000, axes: [128, 128, 0, 255] };
  assert.equal(validInput(input), true);
  for (const invalid of [null, {}, { ...input, seq: -1 }, { ...input, seq: 1.5 },
    { ...input, buttons: 65536 }, { ...input, buttons: -1 }, { ...input, axes: [0, 0] },
    { ...input, axes: [0, 0, 256, 0] }, { ...input, axes: [0, 0, 1.5, 0] }]) {
    assert.equal(Boolean(validInput(invalid)), false);
  }
});

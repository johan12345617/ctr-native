import test from "node:test";
import assert from "node:assert/strict";
import { readInput, validInput, axisByte } from "../input.js";

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
test("input validation rejects malformed, oversized and non-integral values", () => {
  const input = { type: "input", seq: 1, buttons: 0x4000, axes: [128, 128, 0, 255] };
  assert.equal(validInput(input), true);
  for (const invalid of [null, {}, { ...input, seq: -1 }, { ...input, seq: 1.5 },
    { ...input, buttons: 65536 }, { ...input, buttons: -1 }, { ...input, axes: [0, 0] },
    { ...input, axes: [0, 0, 256, 0] }, { ...input, axes: [0, 0, 1.5, 0] }]) {
    assert.equal(Boolean(validInput(invalid)), false);
  }
});

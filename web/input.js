export const KEY_BUTTONS = Object.freeze({
  Space: 0x0001, Enter: 0x0008,
  ArrowUp: 0x0010, ArrowRight: 0x0020, ArrowDown: 0x0040, ArrowLeft: 0x0080,
  ControlLeft: 0x0100, ControlRight: 0x0200, ShiftLeft: 0x0400, ShiftRight: 0x0800,
  KeyZ: 0x1000, KeyV: 0x2000, KeyC: 0x4000, KeyX: 0x8000,
});
const GAMEPAD_BUTTONS = [0x4000, 0x2000, 0x8000, 0x1000, 0x0400, 0x0800, 0x0100, 0x0200, 0x0001, 0x0008, 0x0002, 0x0004, 0x0010, 0x0040, 0x0080, 0x0020];
export function axisByte(value = 0) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.12) return 128;
  return Math.round((Math.max(-1, Math.min(1, value)) + 1) * 127.5);
}
export function readInput(keys, gamepads = [], neutral = false) {
  if (neutral) return { buttons: 0, axes: [128, 128, 128, 128] };
  let buttons = 0;
  for (const key of keys) buttons |= KEY_BUTTONS[key] || 0;
  const pad = Array.from(gamepads).find(candidate => candidate?.connected && candidate.mapping === "standard");
  if (pad) for (let i = 0; i < GAMEPAD_BUTTONS.length; i++) {
    if (pad.buttons[i]?.pressed || pad.buttons[i]?.value > 0.5) buttons |= GAMEPAD_BUTTONS[i];
  }
  return { buttons, axes: pad ? [axisByte(pad.axes[2]), axisByte(pad.axes[3]), axisByte(pad.axes[0]), axisByte(pad.axes[1])] : [128, 128, 128, 128] };
}
export function validInput(packet) {
  return packet?.type === "input" && Number.isSafeInteger(packet.seq) && packet.seq >= 0 &&
    Number.isInteger(packet.buttons) && packet.buttons >= 0 && packet.buttons <= 65535 &&
    Array.isArray(packet.axes) && packet.axes.length === 4 &&
    packet.axes.every(axis => Number.isInteger(axis) && axis >= 0 && axis <= 255);
}

export const KEY_BUTTONS = Object.freeze({
  Space: 0x0001, Enter: 0x0008,
  ArrowUp: 0x0010, ArrowRight: 0x0020, ArrowDown: 0x0040, ArrowLeft: 0x0080,
  ControlLeft: 0x0100, ControlRight: 0x0200, ShiftLeft: 0x0400, ShiftRight: 0x0800,
  KeyZ: 0x1000, KeyV: 0x2000, KeyC: 0x4000, KeyX: 0x8000,
});
const GAMEPAD_BUTTONS = [0x4000, 0x2000, 0x8000, 0x1000, 0x0400, 0x0800, 0x0100, 0x0200, 0x0001, 0x0008, 0x0002, 0x0004, 0x0010, 0x0040, 0x0080, 0x0020];
const SONY_RAW_BUTTONS = [0x8000, 0x4000, 0x2000, 0x1000, 0x0400, 0x0800, 0, 0, 0x0001, 0x0008, 0x0002, 0x0004];
const HAT_BUTTONS = [0x10, 0x30, 0x20, 0x60, 0x40, 0xc0, 0x80, 0x90];
const neutralPad = () => ({ buttons: 0, axes: [128, 128, 128, 128] });
const pressed = button => button?.pressed === true || button?.value > 0.5;
const active = pad => pad.buttons !== 0 || pad.axes.some(axis => Math.abs(axis - 128) > 32);
export function gamepadProfile(pad) {
  if (!pad?.connected) return;
  if (pad.mapping === "standard") return "standard";
  // Known Windows raw HID layout only. Never guess an unknown pad's button order.
  const sony = /(?:vendor:\s*054c\s+product:\s*(?:05c4|09cc|0ba0|0ce6|0df2)|054c-(?:05c4|09cc|0ba0|0ce6|0df2)|dualsense|dualshock\s*4)/i.test(pad.id || "");
  if (sony && pad.buttons?.length >= 14 && pad.axes?.length >= 10) return "sony-hid";
  if (/xinput/i.test(pad.id || "") && pad.buttons?.length >= 16 && pad.axes?.length >= 4) return "standard";
}
export function readGamepad(pad) {
  const profile = gamepadProfile(pad);
  if (!profile) return;
  let buttons = 0;
  const mapping = profile === "standard" ? GAMEPAD_BUTTONS : SONY_RAW_BUTTONS;
  for (let i = 0; i < mapping.length; i++) if (pressed(pad.buttons[i])) buttons |= mapping[i];
  if (profile === "sony-hid") {
    if (Number.isFinite(pad.axes[3]) && pad.axes[3] > 0) buttons |= 0x100;
    if (Number.isFinite(pad.axes[4]) && pad.axes[4] > 0) buttons |= 0x200;
    const hat = pad.axes[9];
    if (Number.isFinite(hat) && hat >= -1 && hat <= 1) {
      const direction = (hat + 1) * 3.5, rounded = Math.round(direction);
      if (Math.abs(direction - rounded) < 0.1) buttons |= HAT_BUTTONS[rounded];
    }
  }
  return { buttons, axes: [axisByte(pad.axes[2]), axisByte(pad.axes[profile === "sony-hid" ? 5 : 3]), axisByte(pad.axes[0]), axisByte(pad.axes[1])] };
}
export function connectedGamepads() {
  try { return Array.from(navigator.getGamepads?.() || []); }
  catch { return []; }
}
function combineKeys(keys, pad = neutralPad()) {
  let buttons = pad.buttons;
  for (const key of keys) buttons |= KEY_BUTTONS[key] || 0;
  return { buttons, axes: [...pad.axes] };
}
export function focusGamepadScreen(screen, pad) {
  if (!active(pad) || document.hidden || document.activeElement === screen) return;
  const target = document.activeElement;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName)) return;
  screen.focus({ preventScroll: true });
}
// Stable local slots; online uses whichever connected controller was last used.
export class BrowserGamepads {
  constructor() { this.slots = Array(4).fill(null); this.previous = new Map(); this.rumbles = new Map(); }
  poll(gamepads = connectedGamepads()) {
    const pads = new Map();
    for (const [position, gamepad] of Array.from(gamepads).entries()) {
      const pad = readGamepad(gamepad);
      if (!pad) continue;
      const index = gamepad.index ?? position;
      pads.set(index, pad);
      const previous = this.previous.get(index);
      if (active(pad) && (!previous || previous.buttons !== pad.buttons || pad.axes.some((axis, i) => axis !== previous.axes[i]))) this.selectedIndex = index;
    }
    this.slots = this.slots.map(index => pads.has(index) ? index : null);
    for (const index of pads.keys()) if (!this.slots.includes(index)) {
      const available = this.slots.indexOf(null);
      if (available !== -1) this.slots[available] = index;
    }
    if (!pads.has(this.selectedIndex)) this.selectedIndex = pads.keys().next().value;
    this.previous = pads;
    return this.slots.map(index => index === null ? undefined : pads.get(index));
  }
  read(keys, gamepads = connectedGamepads(), neutral = false) {
    this.poll(gamepads);
    return neutral ? neutralPad() : combineKeys(keys, this.previous.get(this.selectedIndex));
  }
  apply(module, neutral = false) {
    const pads = this.poll();
    pads.forEach((pad, slot) => {
      const input = neutral ? neutralPad() : pad || neutralPad();
      module._CTR_WebSetGamepad(slot, pad ? 1 : 0, input.buttons, ...input.axes);
    });
    return neutral ? neutralPad() : this.previous.get(this.selectedIndex) || neutralPad();
  }
  rumble(slot, strong, weak, now = performance.now()) {
    const index = slot === undefined ? this.selectedIndex : this.slots[slot];
    if (index === null || index === undefined || document.hidden) return;
    const pad = connectedGamepads().find((pad, position) => (pad?.index ?? position) === index);
    const actuator = pad?.vibrationActuator;
    if (!actuator?.playEffect) return;
    const previous = this.rumbles.get(index);
    if (previous && previous.strong === strong && previous.weak === weak &&
        ((!strong && !weak) || now - previous.at < 100)) return;
    this.rumbles.set(index, { strong, weak, at: now });
    try {
      const effect = !strong && !weak && actuator.reset ? actuator.reset()
        : actuator.playEffect("dual-rumble", { duration: 200, startDelay: 0,
          strongMagnitude: Math.max(0, Math.min(1, strong / 65535)), weakMagnitude: Math.max(0, Math.min(1, weak / 65535)) });
      void Promise.resolve(effect).catch(() => {});
    } catch { /* A missing/unsupported actuator does not affect controls. */ }
  }
}
export function axisByte(value = 0) {
  if (!Number.isFinite(value) || Math.abs(value) < 0.12) return 128;
  return Math.round((Math.max(-1, Math.min(1, value)) + 1) * 127.5);
}
export function readInput(keys, gamepads = [], neutral = false) {
  if (neutral) return neutralPad();
  const pads = Array.from(gamepads).map(readGamepad).filter(Boolean);
  return combineKeys(keys, pads.find(active) || pads[0]);
}
export function validInput(packet) {
  return packet?.type === "input" && Number.isSafeInteger(packet.seq) && packet.seq >= 0 &&
    Number.isInteger(packet.buttons) && packet.buttons >= 0 && packet.buttons <= 65535 &&
    Array.isArray(packet.axes) && packet.axes.length === 4 &&
    packet.axes.every(axis => Number.isInteger(axis) && axis >= 0 && axis <= 255);
}

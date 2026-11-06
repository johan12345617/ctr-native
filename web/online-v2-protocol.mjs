// Shared by the worker, coordinator, probe and browser feasibility client.
export const PROTOCOL = 4;
export const OBSERVATION_BYTES = 1856;
export const TICK_MS = 2 * 897619 * 1000 / 53693175;
export const MAX_TICK = 0x7ffffffe;
export const MAX_PREDICTION_TICKS = 8;
// Receiving future controls does not require keeping that many rendered worlds.
export const MAX_INPUT_LEAD_TICKS = 64;
export const PREDICTION_CHECKPOINTS = MAX_PREDICTION_TICKS + 1;
export const neutralPad = () => ({ buttons: 0, axes: [128, 128, 128, 128] });
export function validPad(pad) {
  return pad !== null && typeof pad === "object" && Number.isInteger(pad.buttons) &&
    pad.buttons >= 0 && pad.buttons <= 65535 && Array.isArray(pad.axes) && pad.axes.length === 4 &&
    pad.axes.every(axis => Number.isInteger(axis) && axis >= 0 && axis <= 255);
}
export function validConfig(config) {
  return config !== null && typeof config === "object" && config.protocol === PROTOCOL &&
    Number.isInteger(config.players) && config.players >= 2 && config.players <= 4 &&
    Number.isInteger(config.track) && config.track >= 0 && config.track < 18 &&
    Number.isInteger(config.seed) && config.seed >= 0 && config.seed <= 0xffffffff &&
    (config.prediction === undefined || typeof config.prediction === "boolean") &&
    (config.flow === undefined || (config.flow === "menu" && config.players === 2)) &&
    (config.prediction !== true || config.players === 2);
}
export const copyPad = pad => ({ buttons: pad.buttons, axes: [...pad.axes] });
export const samePad = (a, b) => a.buttons === b.buttons && a.axes.every((axis, i) => axis === b.axes[i]);
export function validObservation(state) {
  return (Array.isArray(state) || state instanceof Uint8Array) && state.length === OBSERVATION_BYTES &&
    state.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255);
}

const FRAME_MAGIC = 0x34525443; // CTR4, little-endian
const FRAME_HEADER = 24;
export function encodeFrame(frame) {
  const count = frame?.pads?.length;
  if (!Number.isInteger(frame?.tick) || frame.tick < 1 || frame.tick > MAX_TICK ||
    !Array.isArray(frame.pads) || count < 2 || count > 4 || !frame.pads.every(validPad) || !validObservation(frame.state) ||
    (frame.milliseconds !== undefined && (!Number.isFinite(Math.fround(frame.milliseconds)) || frame.milliseconds < 0)) ||
    (frame.missingInputs !== undefined && (!Array.isArray(frame.missingInputs) || frame.missingInputs.length !== count ||
      !frame.missingInputs.every(value => typeof value === "boolean")))) {
    throw new Error("Invalid authoritative frame.");
  }
  const bytes = new Uint8Array(FRAME_HEADER + count * 6 + OBSERVATION_BYTES);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, FRAME_MAGIC, true); view.setUint32(4, frame.tick, true);
  view.setFloat32(8, Number.isFinite(frame.milliseconds) ? frame.milliseconds : 0, true);
  view.setUint8(12, count);
  view.setUint8(13, frame.missingInputs?.reduce((mask, missing, i) => mask | (missing ? 1 << i : 0), 0) || 0);
  view.setUint16(14, PROTOCOL, true); view.setUint32(16, OBSERVATION_BYTES, true);
  let offset = FRAME_HEADER;
  for (const pad of frame.pads) {
    view.setUint16(offset, pad.buttons, true); bytes.set(pad.axes, offset + 2); offset += 6;
  }
  bytes.set(frame.state, offset);
  return bytes;
}
export function decodeFrame(data) {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) :
    ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
  if (!bytes || bytes.byteLength < FRAME_HEADER) throw new Error("Truncated authoritative frame.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint8(12), tick = view.getUint32(4, true), mask = view.getUint8(13);
  if (view.getUint32(0, true) !== FRAME_MAGIC || view.getUint16(14, true) !== PROTOCOL ||
    view.getUint32(16, true) !== OBSERVATION_BYTES || view.getUint32(20, true) !== 0 ||
    count < 2 || count > 4 || tick < 1 || tick > MAX_TICK || mask >> count ||
    bytes.byteLength !== FRAME_HEADER + count * 6 + OBSERVATION_BYTES ||
    !Number.isFinite(view.getFloat32(8, true)) || view.getFloat32(8, true) < 0) throw new Error("Invalid authoritative frame header.");
  const pads = [], missingInputs = [];
  let offset = FRAME_HEADER;
  for (let slot = 0; slot < count; slot++) {
    pads.push({ buttons: view.getUint16(offset, true), axes: Array.from(bytes.subarray(offset + 2, offset + 6)) });
    missingInputs.push(Boolean(mask & (1 << slot))); offset += 6;
  }
  return { type: "frame", tick, milliseconds: view.getFloat32(8, true), pads, missingInputs, state: bytes.subarray(offset) };
}
export function observationHash(bytes) {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return hash.toString(16).padStart(8, "0");
}
export function firstDifference(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

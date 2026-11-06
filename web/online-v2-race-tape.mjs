// Repeatable driving input for automated physics/prediction probes, not bots or
// gameplay logic. Uses the original hop/drift buttons and opposite-side boosts.
export function racePad(frame, slot) {
  let buttons = 0x4000;
  if (frame >= 150) {
    const phase = (frame - 150) % 200;
    const turn = slot === 0 ? 0x20 : 0x80;
    if (phase >= 10 && phase < 80) buttons |= 0x0400 | turn;
    if (phase === 40 || phase === 65) buttons |= 0x0800;
    if (phase >= 110 && phase < 115) buttons |= 0x0800;
    if (phase >= 145 && phase < 155) buttons |= slot === 0 ? 0x80 : 0x20;
  }
  return { buttons, axes: [128, 128, 128, 128] };
}

export function physicsCoverage(state, result = { movingFrames: 0, driftFrames: 0,
  boostFrames: 0, airborneFrames: 0, kartCollisionFrames: 0, inventoryFrames: 0 }) {
  const view = new DataView(Uint8Array.from(state).buffer);
  const flags = { movingFrames: false, driftFrames: false, boostFrames: false,
    airborneFrames: false, kartCollisionFrames: false, inventoryFrames: false };
  for (let slot = 0; slot < 2; slot++) {
    const base = (16 + slot * 24) * 4;
    const actions = view.getUint32(base + 10 * 4, true);
    flags.movingFrames ||= view.getInt32(base + 7 * 4, true) !== 0;
    flags.driftFrames ||= view.getUint32(base + 9 * 4, true) === 2;
    flags.boostFrames ||= view.getInt32(base + 8 * 4, true) > 0;
    flags.airborneFrames ||= (actions & (0x80000 | 0x400)) !== 0;
    flags.kartCollisionFrames ||= (actions & 0x10000000) !== 0;
    flags.inventoryFrames ||= view.getUint32(base + 14 * 4, true) > 0;
  }
  for (const key of Object.keys(flags)) if (flags[key]) result[key]++;
  return result;
}

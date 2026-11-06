import { TICK_MS, MAX_PREDICTION_TICKS, MAX_INPUT_LEAD_TICKS } from "./online-v2-protocol.mjs";

// Network scheduling can cover a slower connection without expanding the
// bounded local prediction/rollback history.
export class LatencyEstimator {
  constructor() { this.rttMs = 0; this.jitterMs = 0; this.samples = 0; }
  record(sample) {
    if (!Number.isFinite(sample) || sample < 0 || sample > 10000) return false;
    if (!this.samples) this.rttMs = sample;
    else {
      this.jitterMs += (Math.abs(sample - this.rttMs) - this.jitterMs) / 4;
      this.rttMs += (sample - this.rttMs) / 8;
    }
    this.samples++;
    return true;
  }
  get inputLead() { return Math.max(2, Math.min(MAX_INPUT_LEAD_TICKS, Math.ceil((this.rttMs + 2 * this.jitterMs) / TICK_MS) + 1)); }
  get predictionLead() { return Math.min(MAX_PREDICTION_TICKS, this.inputLead); }
}

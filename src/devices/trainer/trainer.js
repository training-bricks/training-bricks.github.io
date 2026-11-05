/**
 * What every smart trainer driver shares: the events, the descriptor's
 * capabilities and limits, modes, and targets clamped to those limits. In
 * ERG a new power target is not sent at once: it is spread over ERG_RAMP_S
 * (ergRamp), so a big jump does not stall the legs (the ERG "spiral of
 * death"). Short efforts ask for a quick one (QUICK_RAMP_S), or the ramp
 * would eat a good part of them. Drivers implement the hooks _sendPower(w),
 * _sendResistance(pct), _sendSimulation(params), _sendStop() and
 * _applyMode(mode), plus connect, disconnect and connected. Readings are published as TrainerState (types.js).
 */

const noop = () => {};

export const ERG_RAMP_S = 2.5;
export const QUICK_RAMP_S = 1;
const RAMP_EVERY_MS = 500;

const clamp = (v, lo, hi) => Math.min(hi ?? Infinity, Math.max(lo ?? -Infinity, v));
const roundTo = (v, step) => (step ? Math.round(v / step) * step : v);

/** Watts to send, every everyMs, to go from one power to another over `seconds` (ends exactly at `to`). */
export function ergRamp(from, to, seconds = ERG_RAMP_S, everyMs = RAMP_EVERY_MS) {
  const n = Math.max(1, Math.round((seconds * 1000) / everyMs));
  if (from == null || from === to) return [to];
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? to : Math.round(from + ((to - from) * (i + 1)) / n)));
}

export class Trainer {
  constructor({ onStatus = noop, onData = noop, onInfo = noop, onLog = noop, onControlLost = noop } = {}, descriptor = {}) {
    Object.assign(this, { onStatus, onData, onInfo, onLog, onControlLost });
    this.descriptor = descriptor;
    this.capabilities = { ...descriptor.capabilities };
    this.limits = { ...descriptor.limits };
    this.requested = { power: null, resistance: null, simulation: null };
    this.mode = 'idle';
    this.sentPower = null;   // last watts actually sent (start of the next ramp)
    this.rampSeconds = ERG_RAMP_S;   // tests shorten these
    this.rampMs = RAMP_EVERY_MS;
    this._ramp = null;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this._cancelRamp();
    this.mode = mode;
    this._applyMode?.(mode);
  }

  /** ERG: asks for a power (W) within the limits, reached through a short ramp (quick: at most QUICK_RAMP_S). */
  setTarget({ power, quick = false } = {}) {
    if (power == null) return;
    const l = this.limits;
    const w = roundTo(clamp(power, l.powerMin, l.powerMax), l.powerStep);
    this.requested.power = w;
    if (this.mode !== 'erg') this.setMode('erg');
    this._cancelRamp();
    // Scaled like rampSeconds, which tests shorten
    const seconds = quick ? Math.min(this.rampSeconds, QUICK_RAMP_S * (this.rampSeconds / ERG_RAMP_S)) : this.rampSeconds;
    const steps = ergRamp(this.sentPower, w, seconds, this.rampMs);
    const sendNext = () => {
      const v = steps.shift();
      this.sentPower = v;
      this._sendPower(v);
      this._ramp = steps.length ? setTimeout(sendNext, this.rampMs) : null;
    };
    sendNext();
  }

  /** Resistance mode (sprints, tests): % of the trainer's range. */
  setResistance(pct) {
    const l = this.limits;
    this.requested.resistance = clamp(pct, l.resistanceMin ?? 0, l.resistanceMax ?? 100);
    if (this.mode !== 'resistance') this.setMode('resistance');
    this._sendResistance(this.requested.resistance);
  }

  /** Grade simulation: grade %, wind (m/s), rolling resistance and drag coefficients. */
  setSimulation({ grade = 0, windSpeed = 0, crr = 0.004, cw = 0.51 } = {}) {
    const l = this.limits;
    this.requested.simulation = { grade: clamp(grade, l.gradeMin, l.gradeMax), windSpeed, crr, cw };
    if (this.mode !== 'simulation') this.setMode('simulation');
    this._sendSimulation(this.requested.simulation);
  }

  /** Stops any target and releases the trainer. */
  stop() {
    this._cancelRamp();
    this.mode = 'idle';
    this.sentPower = null;
    this._sendStop?.();
  }

  pause() { this.stop(); }

  pauseNow() { this.stop(); }

  diagnostics() {
    return [];
  }

  _cancelRamp() {
    clearTimeout(this._ramp);
    this._ramp = null;
  }
}

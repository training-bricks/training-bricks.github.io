/**
 * Speed adjustment by heart rate: the decision, without timing or state.
 *
 * - It looks ahead: while HR climbs it is projected LEAD_S seconds with its
 *   recent slope, so speed drops before HR crosses the limit. A falling HR is
 *   not projected: a short dip must not ask for more speed (#10).
 * - Steps with an HR target aim at the middle of the range, or lower on
 *   aerobic steps (AEROBIC_AIM), not at its top.
 * - It reads HR through hrTrend(): the mean of the last seconds, so a single
 *   spike does not count, and it only projects when HR is really rising.
 *   On 2026-11-04 both drops of the Z2 steps came from projecting a blip and
 *   were undone 25 s later.
 * - The correction is proportional to how far off HR is (gain per bpm,
 *   between a smallest and a largest step). Rises are smaller and never
 *   happen while HR is still climbing: HR lags 1–2 min behind effort (#10).
 * - The actuator says the units: SPEED (km/h, treadmill) or POWER (W, smart
 *   trainer in ERG, #8). The rules and the timing are the same: what limits
 *   them is how slowly HR answers, not the device.
 * - Steps that follow HR by incline use the same decision, turned into
 *   incline by inclineStep().
 * - α1 guard: on aerobic steps (Z1–Z2), a sustained α1 below VT1 means the
 *   effort is above the aerobic threshold even if HR is still in its zone.
 *   It has two parts (#10, 2026-10-30):
 *   - veto: speed never rises, even with HR in Z1. Without it the HR target
 *     (aiming at ~40 % of Z2) and the guard fought at the Z1/Z2 boundary,
 *     a ±0.2 km/h sawtooth for 27 min;
 *   - drop: speed goes down, but not in the warm-up nor with HR in Z1, where
 *     α1 is not in steady state.
 *   Neither acts in the cool-down, which already slows down.
 */

import { VT1 } from '../physiology/hrv.js';

export const LEAD_S = 30;        // how far ahead HR is projected
export const SLOPE_WINDOW_S = 30; // samples used for the HR slope (20 s was too noisy, #10)
export const AEROBIC_AIM = 0.4;  // HR-target steps in Z1–Z2 aim at 40 % of the range (VT1 sits near the middle of Z2, #10)
const DEADBAND = 3;              // bpm around the aim of the range that count as on target
const RISING = 0.05;             // bpm/s (3 bpm/min): HR still climbing, so no rise yet
const LEVEL_S = 10;              // HR for decisions: the mean of this many seconds
const CAP_MARGIN = 5;            // pace (or power) steps give back once HR is this far below the cap
const INCLINE_STEP = 0.5;        // % per incline correction (the treadmill's resolution)
const SEARCH_FAR_BPM = 20;       // searching for the speed: this far under the aim, rises are bigger and do not wait for HR

/**
 * What HR moves, in its units: gain per bpm off target, smallest and largest
 * step, largest rise (going up overshoots, going down does not, #10), the α1
 * correction, the most it may take away or add in a step, and its rounding.
 */
export const SPEED = { unit: 'km/h', gain: 0.1, minStep: 0.1, maxStep: 0.5, maxRise: 0.2, searchRise: 0.5, alphaStep: 0.2, maxDown: 2.0, maxUp: 1.5, decimals: 1 };
/** Watts on a smart trainer in ERG: about 2.5 W per bpm (#8, to be tuned on real rides). */
export const POWER = { unit: 'W', gain: 2.5, minStep: 3, maxStep: 15, maxRise: 5, alphaStep: 5, maxDown: 40, maxUp: 30, decimals: 0 };

export const roundTo = (v, decimals) => Math.round(v * 10 ** decimals) / 10 ** decimals;
const stepFor = (bpm, a) => roundTo(Math.min(a.maxStep, Math.max(a.minStep, a.gain * bpm)), a.decimals);
const riseFor = (bpm, a) => Math.min(a.maxRise, stepFor(bpm, a));

/** HR slope (bpm/s) by least squares over `samples` ({elapsed, hr}). */
export function hrSlope(samples) {
  const pts = samples.filter((s) => s.hr > 0);
  if (pts.length < 5) return 0;
  const n = pts.length;
  const mx = pts.reduce((a, s) => a + s.elapsed, 0) / n;
  const my = pts.reduce((a, s) => a + s.hr, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of pts) {
    num += (s.elapsed - mx) * (s.hr - my);
    den += (s.elapsed - mx) ** 2;
  }
  return den ? num / den : 0;
}

const meanHr = (samples, seconds) => {
  const last = samples.at(-1)?.elapsed;
  const hrs = samples.filter((s) => s.hr > 0 && s.elapsed > last - seconds).map((s) => s.hr);
  return hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : null;
};

/**
 * HR for a decision: `level`, its mean over LEVEL_S; and `rising`, whether the
 * shorter means are above the longer ones. The slope stays on its 30 s window:
 * over 10 s it predicts HR 30 s ahead much worse (2026-11-04: off by 7.8 bpm, 5.3 with 30 s).
 * Null with no HR in the samples.
 */
export function hrTrend(samples) {
  const level = meanHr(samples, LEVEL_S);
  if (level == null) return null;
  const [m3, m5] = [meanHr(samples, 3), meanHr(samples, 5)];
  return { level: Math.round(level * 10) / 10, rising: m3 > m5 && m5 > level };
}

/**
 * Change (in the actuator's units: km/h by default, W with POWER) the HR asks
 * for right now; 0 = leave it.
 * @param {{mode: 'cap'|'target', lo: number, hi: number, hr: number, slope: number,
 *          hrAdjust: number, alphaVeto?: boolean, alphaDrop?: boolean, giveBack?: boolean, aim?: number, search?: boolean, project?: boolean}} p
 *   hrAdjust: already removed (< 0) or added (> 0) in this step, in the actuator's units.
 *   alphaVeto: α1 is below VT1 on an aerobic step: no rise.
 *   alphaDrop: and speed should come down for it (see alphaDropApplies).
 *   giveBack: a capped step may return what HR took (not in the cool-down).
 *   aim: where in the range an HR target aims (0 = bottom, 0.5 = middle).
 *   project: HR is rising, so it counts ahead with the slope (see hrTrend).
 *   search: the step has no planned speed. Far under the aim the projected HR
 *   still has to catch up with a belt that may be at a walk, so a rise does not wait.
 * @param actuator SPEED (default) or POWER
 * @returns {{delta: number, reason: string, alpha: boolean, far?: boolean}} alpha: the change is the α1 drop. far: a search rise, far under the aim.
 */
export function hrDecision({ mode, lo, hi, hr, slope, hrAdjust, alphaVeto = false, alphaDrop = false, giveBack = true, aim = 0.5, search = false, project = true }, actuator = SPEED) {
  const a = actuator;
  const projected = hr + (project ? Math.max(0, slope) * LEAD_S : 0);
  const climbing = slope > RISING;
  let delta = 0;
  let reason = '';
  let far = false;

  if (mode === 'target') {
    const goal = lo + (hi - lo) * aim;
    const off = projected - goal;
    if (off > DEADBAND) {
      delta = -stepFor(off - DEADBAND, a);
      reason = `HR → ${Math.round(projected)}, aiming at ${Math.round(goal)}`;
    } else if (search && off <= -SEARCH_FAR_BPM && !alphaVeto) {
      far = true;
      delta = a.searchRise;
      reason = `HR → ${Math.round(projected)}, searching for ${Math.round(goal)}`;
    } else if (off < -DEADBAND && !alphaVeto && !climbing) {
      delta = riseFor(-off - DEADBAND, a);
      reason = `HR → ${Math.round(projected)}, aiming at ${Math.round(goal)}`;
    }
  } else if (mode === 'cap') {
    if (projected > hi) {
      delta = -stepFor(projected - hi, a);
      reason = `HR → ${Math.round(projected)}, cap ${hi}`;
    } else if (giveBack && hrAdjust < 0 && hr < hi - CAP_MARGIN && slope <= 0 && !alphaVeto) {
      delta = Math.min(-hrAdjust, riseFor(hi - CAP_MARGIN - hr, a));
      reason = `HR ${hr} back under cap ${hi}`;
    }
  }

  let alpha = false;
  if (alphaDrop && delta >= 0) {
    delta = -a.alphaStep;
    reason = `α1 below ${VT1} with HR ${hr}`;
    alpha = true;
  }
  return { delta: roundTo(delta, a.decimals), reason, alpha, ...(far && !alpha && { far }) };
}

/** Whether a low α1 blocks rises on a step: aerobic (Z1–Z2), not the warm-up nor the cool-down. */
export function alphaVetoApplies({ zone, warmup, cooldown }) {
  return zone != null && zone <= 2 && !warmup && !cooldown;
}

/**
 * Whether a low α1 also brings speed down: as the veto, and HR above Z1.
 * Early in exercise and at easy effort α1 is not in steady state and reads
 * low (2026-10-28: 0.52–0.70 at 114–117 bpm, 0.83 later at 142 bpm), which
 * slowed a warm-up for nothing (#10).
 */
export function alphaDropApplies({ zone, warmup, cooldown, hr, z1Top }) {
  return alphaVetoApplies({ zone, warmup, cooldown }) && !(z1Top && hr <= z1Top);
}

/**
 * The same correction on the incline (steps with hr.by = 'incline'): walking,
 * 1 % weighs about as much as 0.9 km/h, so small corrections move 0.5 % and
 * big ones (over 0.25 km/h) 1 %.
 */
export function inclineStep(kmh) {
  if (!kmh) return 0;
  return Math.sign(kmh) * (Math.abs(kmh) > 0.25 ? 2 * INCLINE_STEP : INCLINE_STEP);
}

/**
 * Metrics of a steady aerobic run (#4), from the session samples
 * ({ elapsed, speed, incline, hr, alpha1, step }):
 *
 * - Aerobic decoupling (Pa:HR): how much efficiency (flat-equivalent speed ÷
 *   HR) falls from the first half of the steady part to the second. Under
 *   5 % suggests a solid aerobic base for that pace; over 10 %, the pace was
 *   too much that day. With HR control HR stays flat, so it shows as speed
 *   dropping.
 * - HR at VT1 of the session: where α1 crosses 0.75, from a straight line
 *   α1 = f(HR) as in the threshold test (thresholds.js). A steady run moves
 *   HR little, so the line needs the warm-up's rise, and it is fitted on the
 *   median α1 of each 3 bpm band: otherwise the long, noisy minutes at the
 *   run's HR outweigh the rest (2026-10-30: r² 0.43 on raw points, VT1 ≈ 126
 *   either way). Without a clean line only the median α1 at the run's HR is
 *   given. An estimate, not a test:
 *   α1 also falls with time and fatigue and varies from day to day, so the
 *   trend of several runs is what counts.
 */
import { VT1, ALPHA_WINDOW_MS } from './hrv.js';
import { flatKmh, fit, POINT_EVERY_S } from './thresholds.js';

export const STEADY_MIN_S = 20 * 60;  // shortest steady part with metrics
export const SETTLE_S = 5 * 60;       // first minutes of the steady part left out (HR settling)
const MOVING_KMH = 0.5;
const ALPHA_FROM_S = 180;             // α1 values from the first 3 min are not in steady state
const FIT_RANGE = [0.3, 1.1];         // as in the threshold test
const MIN_POINTS = 24;                // 2 min of α1 values (one every 5 s)
const BAND_BPM = 3;                   // HR bands for the line, each its median α1…
const BAND_MIN_POINTS = 4;            // …from at least this many values
const MIN_BANDS = 5;
const MIN_HR_SPAN = 15;               // bpm the bands must cover for a line
const MIN_R2 = 0.6;
const VT1_MARGIN = 5;                 // bpm VT1 may fall outside the HR the points cover

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null;
};
const round = (v, d = 0) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Whether a run's metrics make sense: every step that is not a warm-up or
 * a cool-down is aerobic (Z1–Z2) and none is a test. A free session
 * (no steps) counts too.
 */
export function isAerobicRun(steps = []) {
  const main = steps.filter((s) => !s.warmup && !s.cooldown);
  return main.every((s) => !s.test && (s.zone == null || s.zone <= 2));
}

/**
 * The steady part: samples of the main steps (not warm-up nor cool-down),
 * moving, with HR, minus its first SETTLE_S seconds.
 */
export function steadyPart(samples, steps = []) {
  const edge = (n) => n != null && (steps[n - 1]?.warmup || steps[n - 1]?.cooldown);
  const main = samples.filter((s) => !edge(s.step) && s.speed >= MOVING_KMH && s.hr > 0);
  if (!main.length) return [];
  const from = main[0].elapsed + SETTLE_S;
  return main.filter((s) => s.elapsed >= from);
}

/** Pa:HR decoupling of the steady part, or null when it is shorter than STEADY_MIN_S. */
export function decoupling(steady) {
  if (!steady.length || steady.at(-1).elapsed - steady[0].elapsed < STEADY_MIN_S) return null;
  const mid = (steady[0].elapsed + steady.at(-1).elapsed) / 2;
  const ef = (part) => {
    const kmh = part.reduce((a, s) => a + flatKmh(s.speed, s.incline || 0), 0) / part.length;
    const hr = part.reduce((a, s) => a + s.hr, 0) / part.length;
    return { kmh, hr, ef: kmh / hr };
  };
  const a = ef(steady.filter((s) => s.elapsed < mid));
  const b = ef(steady.filter((s) => s.elapsed >= mid));
  return {
    pct: round((100 * (a.ef - b.ef)) / a.ef, 1),
    first: { kmh: round(a.kmh, 2), hr: round(a.hr) },
    second: { kmh: round(b.kmh, 2), hr: round(b.hr) },
    minutes: round((steady.at(-1).elapsed - steady[0].elapsed) / 60),
  };
}

/**
 * HR at VT1 from the whole run (warm-up included: its rise gives the line
 * its slope). Each α1 is paired with the mean HR of its own 2 min window.
 * @returns {{hr, r2, points, bands}|null} null when the points do not support a line.
 */
export function vt1FromRun(samples) {
  const win = ALPHA_WINDOW_MS / 1000;
  const pts = [];
  let lastT = -Infinity;
  for (const s of samples) {
    if (s.elapsed < ALPHA_FROM_S || s.alpha1 == null || s.elapsed - lastT < POINT_EVERY_S) continue;
    if (s.alpha1 < FIT_RANGE[0] || s.alpha1 > FIT_RANGE[1]) continue;
    lastT = s.elapsed;
    const w = samples.filter((x) => x.elapsed > s.elapsed - win && x.elapsed <= s.elapsed && x.hr > 0);
    if (w.length) pts.push({ alpha: s.alpha1, hr: w.reduce((a, x) => a + x.hr, 0) / w.length });
  }
  if (pts.length < MIN_POINTS) return null;
  const bands = new Map();
  for (const p of pts) {
    const k = Math.floor(p.hr / BAND_BPM);
    bands.set(k, [...(bands.get(k) ?? []), p]);
  }
  const used = [...bands.values()].filter((b) => b.length >= BAND_MIN_POINTS)
    .map((b) => ({ hr: median(b.map((p) => p.hr)), alpha: median(b.map((p) => p.alpha)) }));
  if (used.length < MIN_BANDS) return null;
  const hrs = used.map((b) => b.hr);
  const lo = Math.min(...hrs);
  const hi = Math.max(...hrs);
  if (hi - lo < MIN_HR_SPAN) return null;
  const line = fit(hrs, used.map((b) => b.alpha));
  if (line.slope >= 0 || line.r2 < MIN_R2) return null;
  const hr = (VT1 - line.icpt) / line.slope;
  if (hr < lo - VT1_MARGIN || hr > hi + VT1_MARGIN) return null;
  return { hr: Math.round(hr), r2: round(line.r2, 2), points: pts.length, bands: used.length };
}

/** α1 over the steady part: median, its share under VT1, at the part's mean HR. */
export function alphaOfSteady(steady) {
  const al = steady.filter((s) => s.alpha1 != null).map((s) => s.alpha1);
  if (al.length < steady.length / 2) return null;
  return {
    median: round(median(al), 2),
    underVt1: Math.round((100 * al.filter((a) => a < VT1).length) / al.length),
    hr: Math.round(steady.reduce((a, s) => a + s.hr, 0) / steady.length),
  };
}

/**
 * Everything for one run, or null when it is not a steady aerobic run with
 * a long enough steady part.
 */
export function aerobicSummary(samples, steps = []) {
  if (!isAerobicRun(steps)) return null;
  const steady = steadyPart(samples, steps);
  const dec = decoupling(steady);
  if (!dec) return null;
  const totalKm = samples.at(-1)?.distance ? round(samples.at(-1).distance / 1000, 2) : null;
  return { decoupling: dec, vt1: vt1FromRun(samples), alpha: alphaOfSteady(steady), km: totalKm, minutes: round((samples.at(-1)?.elapsed ?? 0) / 60) };
}

/** Median HR at VT1 of the last `n` runs that have one (newest first), or null. */
export function vt1Trend(runs, n = 5) {
  const hrs = runs.filter((r) => r.vt1).slice(0, n).map((r) => r.vt1.hr);
  return hrs.length >= 2 ? { hr: Math.round(median(hrs)), runs: hrs.length } : null;
}

/**
 * Ventilatory thresholds from a ramp test with DFA α1 (Rogers et al., 2021):
 * during a ramp α1 falls roughly in a straight line with HR. Where the fitted
 * line crosses 0.75 is VT1 (aerobic threshold) and where it crosses 0.5,
 * VT2 (close to LTHR).
 *
 * Each α1 covers the previous 2 minutes, so it is paired with the mean HR and
 * the mean effort of that same window: flat-equivalent speed on a run, watts
 * on a bike (#40).
 */

import { VT1, VT2, ALPHA_WINDOW_MS } from './hrv.js';

const MIN_POINTS = 12;          // α1 values (one every 5 s: a minute's worth)
const MIN_R2 = 0.6;             // below this α1 did not follow HR (noisy signal)
const FIT_RANGE = [0.3, 1.1];   // outside it the α1–HR line bends
const MAX_EXTRAPOLATE = 0.1;    // VT2 may be extrapolated this far below the lowest α1
export const POINT_EVERY_S = 5; // α1 is recomputed every 5 s

/** Flat speed with the same cost (ACSM running equation: 0.2·v + 0.9·v·grade). */
export const flatKmh = (kmh, inclinePct) => kmh * (1 + (4.5 * inclinePct) / 100);

/** What a ramp's effort is in each sport, and how it reads in a result. */
const RAMP_EFFORT = {
  run: { key: 'kmh', decimals: 2, of: (s) => flatKmh(s.speed, s.incline || 0) },
  ride: { key: 'w', decimals: 0, of: (s) => s.power ?? 0 },
};

/** Least-squares line y = icpt + slope · x, with its r². */
export function fit(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, v) => a + v, 0) / n;
  const my = ys.reduce((a, v) => a + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  return { slope, icpt: my - slope * mx, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

/**
 * @param samples  session samples ({elapsed, hr, speed, incline, power, alpha1}), the whole session
 * @param t0, t1   elapsed (s) where the ramp started and ended
 * @param sport    'run' | 'ride'
 * @returns {{sport, vt1: {hr, kmh|w}, vt2: {hr, kmh|w, extrapolated}|null, r2, points} | {error: string}}
 *   kmh is the flat-equivalent speed; w, the watts of a ride.
 */
export function analyzeRamp(samples, t0, t1, sport = 'run') {
  const effort = RAMP_EFFORT[sport] ?? RAMP_EFFORT.run;
  const win = ALPHA_WINDOW_MS / 1000;
  const pts = [];
  let lastT = -Infinity;
  for (const s of samples) {
    if (s.elapsed < t0 || s.elapsed > t1 || s.alpha1 == null || s.elapsed - lastT < POINT_EVERY_S) continue;
    lastT = s.elapsed;
    const w = samples.filter((x) => x.elapsed > s.elapsed - win && x.elapsed <= s.elapsed && x.hr > 0);
    if (!w.length) continue;
    pts.push({
      alpha: s.alpha1,
      hr: w.reduce((a, x) => a + x.hr, 0) / w.length,
      effort: w.reduce((a, x) => a + effort.of(x), 0) / w.length,
    });
  }
  const used = pts.filter((p) => p.alpha >= FIT_RANGE[0] && p.alpha <= FIT_RANGE[1]);
  if (used.length < MIN_POINTS) return { error: 'Not enough α1 values: the test needs a chest strap that sends RR intervals.' };
  const minAlpha = Math.min(...used.map((p) => p.alpha));
  if (minAlpha > VT1) return { error: 'α1 never dropped below 0.75: the ramp ended too early.' };
  const byHr = fit(used.map((p) => p.hr), used.map((p) => p.alpha));
  if (byHr.slope >= 0 || byHr.r2 < MIN_R2) return { error: 'α1 did not fall steadily with HR (noisy signal?).' };
  const byEffort = fit(used.map((p) => p.alpha), used.map((p) => p.effort));
  const scale = 10 ** effort.decimals;
  const at = (alpha) => ({
    hr: Math.round((alpha - byHr.icpt) / byHr.slope),
    [effort.key]: Math.round((byEffort.icpt + byEffort.slope * alpha) * scale) / scale,
  });
  const vt2 = minAlpha - MAX_EXTRAPOLATE <= VT2 ? { ...at(VT2), extrapolated: minAlpha > VT2 } : null;
  return { sport, vt1: at(VT1), vt2, r2: Math.round(byHr.r2 * 100) / 100, points: used.length };
}

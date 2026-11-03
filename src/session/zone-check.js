/**
 * Whether the HR zones agree with the VT1 estimated by α1 (#41): VT1 should
 * sit near the top of Z1 / the start of Z2. On 2026-11-01 the bike's VT1
 * (~120 bpm) was 10 bpm under the start of cycling Z2 (130), and an
 * HR-controlled Z2 ride pushed power into Z3 until the α1 guard stopped it.
 * No DOM: Home and Profile show the result (ui/zone-check.js).
 */
import { vt1Trend } from '../physiology/aerobic.js';

export const MISMATCH_BPM = 5;

/**
 * The VT1 to compare, newest first: the last test of the sport, or the trend
 * of its sessions (≥ 2 with VT1), whichever is more recent. Null without one.
 * @param runs, tests  histories (newest first); entries with no sport are runs
 */
export function latestVt1(runs, tests, sport) {
  const test = tests.find((x) => x.vt1 && (x.sport ?? 'run') === sport);
  const trend = vt1Trend(runs, 5, sport);
  const lastRun = runs.find((r) => r.vt1 && (r.sport ?? 'run') === sport);
  if (test && (!trend || new Date(test.date) >= new Date(lastRun.date))) return { hr: test.vt1.hr, source: 'test' };
  return trend ? { hr: trend.hr, source: 'trend' } : null;
}

/**
 * The mismatch of a sport, or null when they agree or there is nothing to compare.
 * @param hrZones  the sport's HR zones ([{ hi }…], from physiology/zones.js)
 * @returns {{sport, vt1, z1Top, z2Start, source}|null}
 */
export function zoneMismatch({ runs = [], tests = [], hrZones = [], sport }) {
  const z1Top = hrZones[0]?.hi;
  const vt1 = latestVt1(runs, tests, sport);
  if (!z1Top || !vt1 || Math.abs(vt1.hr - z1Top) <= MISMATCH_BPM) return null;
  return { sport, vt1: vt1.hr, z1Top, z2Start: z1Top + 1, source: vt1.source };
}

/** Whether it was dismissed for this very VT1 and these zones: it comes back when either changes. */
export const isDismissed = (m, dismissed) => dismissed?.[m.sport] === `${m.vt1}/${m.z1Top}`;

/** What to store to dismiss it. */
export const dismissal = (m, dismissed) => ({ ...dismissed, [m.sport]: `${m.vt1}/${m.z1Top}` });

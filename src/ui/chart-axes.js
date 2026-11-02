/**
 * The session chart's left axis, one object per kind: pace for runs, power
 * for bike workouts. Each says which zones it shades, its domain, where a
 * plan block sits, its ticks, unit, current-zone chip and tooltip rows. No
 * DOM: tested in Node. Adding an axis (e.g. live cadence) = one more object.
 */
import { formatPace } from '../workouts/format.js';
import { paceZoneOf, powerZoneOf } from '../physiology/zones.js';
import { t } from '../i18n/index.js';

// Candidate paces for the left axis (s/km)
const PACE_TICKS = [180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480, 540, 600, 660, 720, 840, 900, 1200, 1500, 1800, 2400, 3600];
const MIN_LABEL_GAP = 26; // px between pace labels

/** "Nice" ticks for an axis: 1, 2, 2.5, 5 × 10^n. */
export function niceTicks(lo, hi, count) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return { ticks, lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step };
}

const hrRow = (hr) => [null, hr.mode === 'cap' ? `≤ ${hr.hi} bpm` : `${hr.lo}–${hr.hi} bpm`, hr.mode === 'cap' ? t('chart.hrCap') : hr.mode === 'info' ? t('chart.hrGoal') : t('chart.hrTarget')];
const targetLabel = (zone) => `${t('chart.target')}${zone ? ` Z${zone}` : ''}`;

export const paceAxis = {
  key: 'speed',
  zonesOf: (z) => z?.pace,
  /**
   * km/h range from the plan, the actual speed and (aligned) HR. Starts and
   * stops (< 3 km/h) do not stretch it: pace explodes near 0. The bottom sits
   * below the lowest speed (`floor`), like in Intervals.
   */
  domain({ plan, samples, hrLeft = [], floor }) {
    const spd = samples.map((s) => s.speed).filter((v) => v >= 3);
    for (const p of plan) if (p.speedStart != null) spd.push(p.speedStart, p.speedEnd);
    spd.push(...hrLeft.filter((v) => v >= 3));
    return { lo: spd.length ? Math.min(...spd) * floor : 3, hi: Math.max(6, ...spd) * 1.08 };
  },
  blockValues: (p) => (p.speedStart != null ? [p.speedStart, p.speedEnd] : null),
  /** Pace labels at the heights of their speed, fastest first, without crowding. */
  ticks(dom, y, { top }) {
    const out = [];
    let lastY = -Infinity;
    for (const sec of PACE_TICKS) {
      const kmh = 3600 / sec;
      if (kmh > dom.hi || kmh < dom.lo + 0.3) continue;
      const yy = y(kmh);
      if (yy < top + 8 || yy - lastY < MIN_LABEL_GAP) continue;
      lastY = yy;
      out.push({ y: yy, label: formatPace(kmh) });
    }
    return out;
  },
  unit: (z) => (z?.power ? '' : 'min/km'), // bike zones without watts: no axis
  chip: (last, z) => (last && last.speed >= 1 ? paceZoneOf(z, last.speed) : null),
  planRows(p) {
    const spd = p.speedStart == null ? t('common.free')
      : p.speedStart === p.speedEnd ? `${formatPace(p.speedStart)}/km` : `${formatPace(p.speedStart)}→${formatPace(p.speedEnd)}/km`;
    return [[null, spd, `${targetLabel(p.zone)} · ${p.incline} %`], ...(p.hr ? [hrRow(p.hr)] : [])];
  },
};

export const powerAxis = {
  key: 'power',
  zonesOf: (z) => z?.power,
  /** Watts of every step, the watts ridden, and aligned HR. */
  domain({ plan, samples = [], hrLeft = [], floor }) {
    const w = plan.flatMap((p) => (p.power ? [p.power.lo, p.power.hi] : []));
    w.push(...samples.map((s) => s.power).filter((v) => v > 0), ...hrLeft);
    if (!w.length) return { lo: 0, hi: 250 };   // a free ride before the first watts
    // Aligned HR may reach below 0 W (a low HR at the start): room for its line, no ticks there
    return { lo: Math.min(...w) * floor, hi: Math.max(...w) * 1.08 };
  },
  /** A ramp goes from lo to hi; a steady step sits in the middle of its range. */
  blockValues(p) {
    if (!p.power) return null;
    const mid = (p.power.lo + p.power.hi) / 2;
    return p.ramp ? [p.power.lo, p.power.hi] : [mid, mid];
  },
  ticks(dom, y, { top, bottom }) {
    return niceTicks(Math.max(0, dom.lo), dom.hi, 4).ticks
      .map((v) => ({ y: y(v), label: String(v) }))
      .filter((t) => t.y >= top + 8 && t.y <= bottom - 4);
  },
  unit: () => 'W',
  chip: (last, z) => (last ? powerZoneOf(z, last.power) : null),
  planRows(p) {
    if (!p.power) return null;
    const { lo, hi } = p.power;
    return [[null, lo === hi ? `${lo} W` : `${lo}${p.ramp ? '→' : '–'}${hi} W`, targetLabel(p.zone)], ...(p.hr ? [[null, `${p.hr.lo}–${p.hr.hi} bpm`, t('chart.hrGoal')]] : [])];
  },
};

/**
 * Power for a bike workout with cycling zones, or for a free ride (cycling
 * zones carry no pace); pace otherwise.
 */
export const leftAxisFor = (zones, plan) => (zones?.power?.length && (plan.some((p) => p.power) || (!plan.length && !zones.pace?.length)) ? powerAxis : paceAxis);

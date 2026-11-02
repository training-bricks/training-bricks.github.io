/**
 * Session chart, Auuki style.
 *
 * A single area. In the background, the whole workout: one block per step,
 * width = duration, height = target speed, color = zone. On top, the actual
 * data: speed, HR and incline, growing as the session advances, and a
 * vertical bar marking progress.
 *
 * - Left axis: pace (min/km), placed at the height of its speed, so blocks
 *   and the speed line share a scale. Bike workouts (cycling zones and steps
 *   in watts) use power (W) instead: block height = target watts.
 * - Right axis: HR (bpm). With zones in the profile, the HR scale is
 *   stretched piecewise so each HR zone sits at the height of the same pace
 *   zone; both columns are shaded with each zone's color and show the
 *   current zone on top.
 * - Incline has no axis (it sits in the lower part); its value is in the
 *   tooltip.
 * - With RR intervals, a ribbon under the time axis paints the DFA α1 at
 *   each moment: aerobic, transition or above the anaerobic threshold.
 *
 * plan:    [{ t0, t1, speedStart, speedEnd, power: {lo, hi}, ramp, incline, zone, hr: {lo, hi, mode} }]   (session s)
 * samples: [{ elapsed, speed, incline, hr, target }]
 */

import { formatDuration, formatPace } from '../workouts/steps.js';
import { DEFAULT_PACE_PCT, hrZoneOf } from '../physiology/zones.js';
import { niceTicks, paceAxis, powerAxis, leftAxisFor } from './chart-axes.js';
import { alphaState } from '../physiology/hrv.js';
import { t } from '../i18n/index.js';

const NS = 'http://www.w3.org/2000/svg';
const MARGIN = { left: 48, right: 46, top: 38 };
const PLOT_H = 280;     // full height; compact charts (workout page and Run) use half
const AXIS_H = 20;      // time ticks under the chart
const RIBBON_H = 12;    // α1 ribbon, under the time axis (only with RR intervals)
const RIBBON_GAP = 6;
const SERIES = [
  { key: 'speed', color: 'var(--series-speed)' },
  { key: 'power', color: 'var(--series-power)' },   // rides: the actual watts (no speed line there)
  { key: 'hr', color: 'var(--series-hr)' },
  { key: 'incline', color: 'var(--series-incline)' },
];

const el = (tag, attrs = {}, parent) => {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
};

function timeTicks(maxSec) {
  const steps = [60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => maxSec / s <= 7) || 3600;
  const out = [];
  for (let t = 0; t <= maxSec; t += step) out.push(t);
  return out;
}

/** Default pace zone for an intensity [start, end] in % of threshold. */
function zoneOfPct(intensity) {
  if (!intensity) return null;
  const v = Math.max(...intensity);
  return DEFAULT_PACE_PCT.findIndex((top) => v <= top) + 1 || DEFAULT_PACE_PCT.length;
}

/** Piecewise linear interpolation; beyond the ends it follows the first or last segment's slope. */
function interp(x, xs, ys) {
  let i = xs.findIndex((v) => x <= v);
  if (i <= 0) i = i === 0 ? 1 : xs.length - 1;
  const [x0, x1, y0, y1] = [xs[i - 1], xs[i], ys[i - 1], ys[i]];
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

const zoneFill = (z) => (z ? `var(--zone-${Math.min(7, z)})` : 'var(--zone-free)');

/** Reduces to ~1 point per pixel, keeping order. */
function thin(samples, maxPoints) {
  if (samples.length <= maxPoints) return samples;
  const stride = samples.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(samples[Math.floor(i * stride)]);
  out.push(samples[samples.length - 1]);
  return out;
}

export class SessionChart {
  /**
   * compact: half height, with the axis starting just below the slowest
   * speed, so easy Z1 space does not take it over (workout page and Run).
   */
  constructor(root, { compact = false } = {}) {
    this.root = root;
    this.plotH = compact ? PLOT_H / 2 : PLOT_H;
    this.floor = compact ? 0.92 : 0.7; // axis bottom, as a fraction of the lowest speed
    this.plan = [];
    this.samples = [];
    this.elapsed = 0;
    this.zones = null;
    this.hoverT = null;

    root.classList.add('viz-root');
    this.svg = el('svg', { class: 'viz-svg', role: 'img', 'aria-label': t('chart.aria') }, root);
    this.tip = document.createElement('div');
    this.tip.className = 'viz-tip hidden';
    root.appendChild(this.tip);

    this.svg.addEventListener('pointermove', (e) => this._onHover(e));
    this.svg.addEventListener('pointerleave', () => { this.hoverT = null; this._drawHover(); });
    new ResizeObserver(() => this.render()).observe(root);
  }

  update({ plan, samples, elapsed, zones }) {
    this.zones = zones || null;
    this.plan = plan || [];
    this.samples = samples || [];
    this.elapsed = elapsed || 0;
    this.render();
  }

  // --- scales ------------------------------------------------------------------

  _domainT() {
    const planEnd = this.plan.length ? this.plan[this.plan.length - 1].t1 : 0;
    if (planEnd) return Math.max(planEnd, this.elapsed);
    return Math.max(600, this.elapsed * 1.05);
  }

  /**
   * HR ↔ left axis mapping that aligns the zones: the top of each HR zone
   * lands at the height of the top of the same pace (or power) zone. Null
   * without zones.
   */
  _hrMap(left) {
    const z = this.zones;
    if (!z?.hr?.length || !left?.length) return null;
    const bpm = [];
    const val = [];
    for (let i = 0; i < Math.min(z.hr.length, left.length) - 1; i++) {
      if (!Number.isFinite(left[i].hi)) break;
      bpm.push(z.hr[i].hi);
      val.push(left[i].hi);
    }
    if (bpm.length < 2) return null;
    return { toLeft: (v) => interp(v, bpm, val), toBpm: (v) => interp(v, val, bpm) };
  }

  /** Vertical scale of each series; the left one comes from the axis (chart-axes.js). */
  _domains() {
    const hrs = this.samples.map((s) => s.hr).filter((v) => v > 0);
    // A Z1 cap starts at 0 bpm: only real heart rates set the scale
    for (const p of this.plan) if (p.hr) hrs.push(...[p.hr.lo, p.hr.hi].filter((v) => v > 0));
    const axis = leftAxisFor(this.zones, this.plan);
    const map = this._hrMap(axis.zonesOf(this.zones));
    // With aligned zones, HR shares the left scale
    const hrLeft = map ? hrs.map(map.toLeft) : [];
    const left = axis.domain({ plan: this.plan, samples: this.samples, hrLeft, floor: this.floor });
    // The speed line always has its own scale (on a bike workout it is not the left axis)
    const speed = axis === paceAxis ? left : paceAxis.domain({ plan: this.plan, samples: this.samples, floor: this.floor });

    let hr;
    if (map) {
      const lo = map.toBpm(left.lo);
      const hi = map.toBpm(left.hi);
      hr = { lo, hi, ticks: niceTicks(lo, hi, 4).ticks.filter((v) => v >= lo && v <= hi), toLeft: map.toLeft };
    } else {
      hr = hrs.length ? niceTicks(Math.max(40, Math.min(...hrs) - 25), Math.max(...hrs) + 5, 4) : niceTicks(80, 190, 4);
    }

    // Watts share the left scale on a bike workout; a free ride gives them their own
    const watts = this.samples.map((s) => s.power).filter((v) => v > 0);
    const power = axis === powerAxis ? left : { lo: 0, hi: Math.max(100, ...watts) * 1.15 };

    const inc = this.samples.map((s) => s.incline);
    for (const p of this.plan) inc.push(p.incline);
    return {
      axis,
      left,
      speed,
      power,
      hr,
      incline: { lo: 0, hi: Math.max(4, ...inc) * 3 }, // stays in the bottom third
    };
  }

  // --- drawing ----------------------------------------------------------------

  render() {
    const width = this.root.clientWidth;
    if (!width) return;
    const svg = this.svg;
    svg.replaceChildren();

    const top = MARGIN.top;
    const bottom = top + this.plotH;
    const hasAlpha = this.samples.some((p) => p.alpha1 !== undefined);
    const totalH = bottom + AXIS_H + (hasAlpha ? RIBBON_GAP + RIBBON_H : 0);
    svg.setAttribute('viewBox', `0 0 ${width} ${totalH}`);
    svg.setAttribute('height', totalH);

    const T = this._domainT();
    const right = width - MARGIN.right;
    const plotW = right - MARGIN.left;
    this.xOf = (t) => MARGIN.left + (t / T) * plotW;
    this.tOf = (x) => ((x - MARGIN.left) / plotW) * T;
    this.box = { top, bottom };

    const dom = this._domains();
    this.yOf = {};
    for (const s of SERIES) {
      const { lo, hi } = dom[s.key];
      this.yOf[s.key] = (v) => bottom - ((Math.max(lo, v) - lo) / (hi - lo)) * this.plotH;
    }
    const { axis, left } = dom;
    const yLeft = axis === paceAxis ? this.yOf.speed : (v) => bottom - ((Math.max(left.lo, v) - left.lo) / (left.hi - left.lo)) * this.plotH;
    this.yOf.left = yLeft;
    if (dom.hr.toLeft) this.yOf.hr = (v) => yLeft(dom.hr.toLeft(v));
    this._drawZoneColumns(dom, right, width);

    // Background: the whole workout. Without speeds (no profile) blocks use
    // the step's relative intensity, so the shape still shows
    const byIntensity = axis === paceAxis && !this.plan.some((p) => p.speedStart != null) && this.plan.some((p) => p.intensity);
    let yInt = null;
    if (byIntensity) {
      const vals = this.plan.flatMap((p) => p.intensity || []);
      const lo = Math.min(...vals) * this.floor;
      const hi = Math.max(...vals) * 1.08;
      yInt = (v) => bottom - ((v - lo) / (hi - lo)) * this.plotH;
    }
    for (const p of this.plan) {
      const x0 = this.xOf(p.t0) + 1; // 2 px gap between blocks
      const x1 = Math.max(x0 + 1, this.xOf(p.t1) - 1);
      let a = bottom - this.plotH * 0.15;
      let b = a;
      const values = axis.blockValues(p);
      if (values) {
        a = yLeft(values[0]);
        b = yLeft(values[1]);
      } else if (yInt && p.intensity) {
        a = yInt(p.intensity[0]);
        b = yInt(p.intensity[1]);
      }
      const zone = p.zone || zoneOfPct(p.intensity);
      const r = Math.min(2, (x1 - x0) / 2);
      el('path', {
        d: `M${x0},${bottom} L${x0},${a + r} Q${x0},${a} ${x0 + r},${a} L${x1 - r},${b} Q${x1},${b} ${x1},${b + r} L${x1},${bottom} Z`,
        class: 'viz-block',
        style: `fill: ${zone ? `var(--zone-${Math.min(7, zone)})` : 'var(--zone-free)'}`,
      }, svg);
    }
    // What is done gets dimmed
    if (this.elapsed > 0 && this.plan.length) {
      const x = this.xOf(Math.min(this.elapsed, T));
      el('rect', { x: MARGIN.left, y: top, width: Math.max(0, x - MARGIN.left), height: this.plotH, class: 'viz-elapsed' }, svg);
    }

    // Left axis (without a profile and before any data, only the shape: no labels)
    for (const t of byIntensity && !this.samples.length ? [] : axis.ticks(left, yLeft, { top, bottom })) {
      el('line', { x1: MARGIN.left, x2: right, y1: t.y, y2: t.y, class: 'viz-grid' }, svg);
      const label = el('text', { x: MARGIN.left - 8, y: t.y + 4, class: 'viz-axis on-band', 'text-anchor': 'end' }, svg);
      label.textContent = t.label;
    }
    // Bike workouts have no speed by design: blocks show the power shape
    if (byIntensity && !this.zones?.power) {
      const msg = el('text', { x: MARGIN.left + 8, y: top + 16, class: 'viz-empty' }, svg);
      msg.textContent = t('chart.noThreshold');
    }

    // Right axis: HR
    for (const v of dom.hr.ticks) {
      const y = this.yOf.hr(v);
      if (y < top + 8 || y > bottom - 4) continue;
      const t = el('text', { x: right + 8, y: y + 4, class: 'viz-axis on-band' }, svg);
      t.textContent = v;
    }

    // Planned incline, only if it changes during the workout
    if (new Set(this.plan.map((p) => p.incline)).size > 1) {
      const d = this.plan.map((p, i) => {
        const y = this.yOf.incline(p.incline).toFixed(1);
        return `${i ? 'L' : 'M'}${this.xOf(p.t0).toFixed(1)},${y} L${this.xOf(p.t1).toFixed(1)},${y}`;
      }).join(' ');
      el('path', { d, class: 'viz-target', style: 'stroke: var(--series-incline)' }, svg);
    }

    // HR cap (or range) of each step
    for (const p of this.plan) {
      if (!p.hr) continue;
      const y = this.yOf.hr(p.hr.hi);
      el('line', { x1: this.xOf(p.t0), x2: this.xOf(p.t1), y1: y, y2: y, class: 'viz-target', style: 'stroke: var(--series-hr)' }, svg);
    }

    // Actual data, on top
    const pts = thin(this.samples, Math.max(50, Math.floor(plotW)));
    const ride = this.samples.some((p) => p.power != null);
    for (const s of [...SERIES].reverse()) {
      if (ride && s.key === 'speed') continue; // a trainer's speed is virtual: power tells the effort
      const series = pts.filter((p) => p[s.key] != null && (s.key === 'incline' || p[s.key] > 0));
      if (series.length < 2) continue;
      const y = this.yOf[s.key];
      const d = series.map((p, i) => `${i ? 'L' : 'M'}${this.xOf(p.elapsed).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('');
      el('path', { d, class: 'viz-line', style: `stroke: ${s.color}` }, svg);
    }
    el('line', { x1: MARGIN.left, x2: right, y1: bottom, y2: bottom, class: 'viz-baseline' }, svg);

    if (!this.plan.length && !this.samples.length) {
      // Wrapped by words to the plot's width (≈ 7 px per character at 13 px)
      const width = Math.max(10, Math.floor((plotW - 16) / 7));
      const lines = [];
      for (const word of t(dom.axis === powerAxis ? 'chart.noWorkoutRide' : 'chart.noWorkout').split(' ')) {
        const last = lines.length - 1;
        if (last >= 0 && `${lines[last]} ${word}`.length <= width) lines[last] += ` ${word}`;
        else lines.push(word);
      }
      const x = MARGIN.left + plotW / 2;
      const msg = el('text', { x, y: top + this.plotH / 2 - ((lines.length - 1) * 16) / 2, class: 'viz-empty', 'text-anchor': 'middle' }, svg);
      lines.forEach((line, i) => { el('tspan', { x, dy: i ? 16 : 0 }, msg).textContent = line; });
    }

    // Progress
    if (this.elapsed > 0) {
      const x = this.xOf(Math.min(this.elapsed, T));
      el('line', { x1: x, x2: x, y1: top, y2: bottom, class: 'viz-now' }, svg);
      el('circle', { cx: x, cy: bottom, r: 4, class: 'viz-now-dot' }, svg);
    }

    // Time axis
    for (const t of timeTicks(T)) {
      const label = el('text', { x: this.xOf(t), y: bottom + 15, class: 'viz-axis', 'text-anchor': t === 0 ? 'start' : 'middle' }, svg);
      label.textContent = `${Math.round(t / 60)}′`;
    }

    if (hasAlpha) this._drawAlphaRibbon(bottom + AXIS_H + RIBBON_GAP);

    this.hoverLayer = el('g', {}, svg);
    this._drawHover();
  }

  /**
   * Axis columns shaded by zone (pace on the left, HR on the right) and the
   * current zone above each unit.
   */
  _drawZoneColumns(dom, right, width) {
    const { top, bottom } = this.box;
    const svg = this.svg;
    const clampY = (y) => Math.min(bottom, Math.max(top, y));
    const column = (zones, yOf, lo, hi, x, w) => {
      zones.forEach((z, i) => {
        // Each band starts where the previous one ends: HR zones are integers
        // (Z1 up to 125, Z2 from 126) and that 1 bpm gap, stretched by the
        // alignment with pace, left uncolored holes
        const zLo = i > 0 ? zones[i - 1].hi : z.lo;
        if (z.hi < lo || zLo > hi) return;
        const y0 = clampY(yOf(Math.min(z.hi, hi)));
        const y1 = clampY(yOf(Math.max(zLo, lo)));
        if (y1 - y0 < 0.5) return;
        el('rect', { x, y: y0, width: w, height: y1 - y0, class: 'viz-band', style: `fill: ${zoneFill(z.z)}` }, svg);
      });
    };
    const z = this.zones;
    const leftZones = dom.axis.zonesOf(z);
    if (leftZones?.length) column(leftZones, this.yOf.left, dom.left.lo, dom.left.hi, 2, MARGIN.left - 4);
    if (z?.hr?.length) column(z.hr, this.yOf.hr, dom.hr.lo, dom.hr.hi, right + 2, MARGIN.right - 4);

    // Current zone above each unit
    const last = this.samples[this.samples.length - 1];
    const pz = dom.axis.chip(last, z);
    const hz = last?.hr > 0 ? hrZoneOf(z, last.hr) : null;
    const head = (zone, unit, xRight) => {
      if (zone) {
        el('rect', { x: xRight - 26, y: 2, width: 26, height: 17, rx: 4, class: 'viz-chip', style: `fill: ${zoneFill(zone)}` }, svg);
        const t = el('text', { x: xRight - 13, y: 15, class: 'viz-chip-text', 'text-anchor': 'middle' }, svg);
        t.textContent = `Z${zone}`;
      }
      const u = el('text', { x: xRight, y: top - 6, class: 'viz-axis', 'text-anchor': 'end' }, svg);
      u.textContent = unit;
    };
    head(pz, dom.axis.unit(z), MARGIN.left - 4);
    head(hz, 'bpm', width - 4);
  }

  /** α1 ribbon: one segment per run of samples with the same state. */
  _drawAlphaRibbon(y) {
    const svg = this.svg;
    const lab = el('text', { x: MARGIN.left - 8, y: y + RIBBON_H - 2, class: 'viz-axis', 'text-anchor': 'end' }, svg);
    lab.textContent = 'α1';
    const s = this.samples;
    let start = null;
    let state = null;
    const flush = (endT) => {
      if (start == null) return;
      const x0 = this.xOf(start);
      const x1 = Math.max(x0 + 1, this.xOf(endT));
      el('rect', { x: x0, y, width: x1 - x0, height: RIBBON_H, class: 'viz-alpha', style: `fill: var(--alpha-${state})` }, svg);
    };
    for (let i = 0; i < s.length; i++) {
      const p = s[i];
      const st = p.alpha1 === undefined ? null : alphaState(p.alpha1) || 'none';
      if (st !== state) {
        flush(p.elapsed);
        start = st ? p.elapsed : null;
        state = st;
      }
    }
    if (s.length) flush(s[s.length - 1].elapsed + 1);
  }

  // --- interaction ------------------------------------------------------------

  _onHover(e) {
    const rect = this.svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    this.hoverT = x < MARGIN.left || x > rect.width - MARGIN.right ? null : Math.max(0, this.tOf(x));
    this._drawHover(x, e.clientY - rect.top);
  }

  _sampleAt(t) {
    const s = this.samples;
    if (!s.length || t > s[s.length - 1].elapsed + 2) return null;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (s[mid].elapsed < t) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && Math.abs(s[lo - 1].elapsed - t) < Math.abs(s[lo].elapsed - t)) lo -= 1;
    return s[lo];
  }

  _planAt(t) {
    return this.plan.find((p) => t >= p.t0 && t < p.t1) || null;
  }

  _drawHover(px, py) {
    if (!this.hoverLayer) return;
    this.hoverLayer.replaceChildren();
    if (this.hoverT == null) {
      this.tip.classList.add('hidden');
      return;
    }
    const sample = this._sampleAt(this.hoverT);
    const plan = this._planAt(this.hoverT);
    const at = sample ? sample.elapsed : this.hoverT;
    const x = this.xOf(at);

    el('line', { x1: x, x2: x, y1: this.box.top, y2: this.box.bottom, class: 'viz-cross' }, this.hoverLayer);
    for (const s of SERIES) {
      const v = sample?.[s.key];
      if (v != null && (s.key === 'incline' || v > 0)) {
        el('circle', { cx: x, cy: this.yOf[s.key](v), r: 4, class: 'viz-dot', style: `fill: ${s.color}` }, this.hoverLayer);
      }
    }

    // Tooltip: value first, label after; built with textContent
    const rows = [];
    if (sample) {
      rows.push(['speed', `${formatPace(sample.speed)}/km`, `${t('chart.pace')} · ${(sample.speed ?? 0).toFixed(1)} km/h`]);
      if (sample.incline != null) rows.push(['incline', `${sample.incline.toFixed(1)} %`, t('chart.incline')]);
      rows.push(['hr', sample.hr > 0 ? `${sample.hr} bpm` : '—', t('common.hr')]);
      if (sample.alpha1 !== undefined) {
        const st = alphaState(sample.alpha1);
        rows.push([`alpha-${st || 'none'}`, sample.alpha1 != null ? sample.alpha1.toFixed(2) : '—', `α1 · ${st ? t(`alpha.${st}`) : t('alpha.noValue')}`]);
      }
    }
    if (plan) rows.push(...(leftAxisFor(this.zones, this.plan).planRows(plan) ?? paceAxis.planRows(plan)));
    this.tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'viz-tip-head';
    head.textContent = formatDuration(at);
    this.tip.appendChild(head);
    for (const [key, value, label] of rows) {
      const row = document.createElement('div');
      row.className = 'viz-tip-row';
      const swatch = document.createElement('span');
      swatch.className = key ? 'viz-key' : 'viz-key plan';
      const zone = plan?.zone || zoneOfPct(plan?.intensity);
      swatch.style.background = key?.startsWith('alpha') ? `var(--${key})`
        : key ? `var(--series-${key})` : zone ? `var(--zone-${Math.min(7, zone)})` : 'var(--zone-free)';
      const strong = document.createElement('strong');
      strong.textContent = value;
      const span = document.createElement('span');
      span.textContent = label;
      row.append(swatch, strong, span);
      this.tip.appendChild(row);
    }
    this.tip.classList.remove('hidden');
    if (px != null) {
      const w = this.root.clientWidth;
      const left = px + 16 + 200 > w ? px - 16 - this.tip.offsetWidth : px + 16;
      this.tip.style.left = `${Math.max(0, left)}px`;
      this.tip.style.top = `${Math.max(0, py - 20)}px`;
    }
  }
}

/**
 * Running step targets: speed from the resolved pace (m/s), HR caps and HR
 * targets from the zones, and the step's label and relative intensity.
 */
import { paceZoneOf, hrTargetRange, hrZoneOf, DEFAULT_PACE_PCT } from '../physiology/zones.js';
import { formatPace } from './format.js';
import { t } from '../i18n/index.js';

const MS_TO_KMH = 3.6;

/** With HR targets, only steps this long follow an HR zone: HR needs 1–2 min to respond. */
export const HR_STEP_MIN_S = 300;
/** Seconds an HR-zone step leaves speed alone while HR climbs (Z3 and above). */
export const HR_SETTLE_S = 150;

/** Picks the target speed within the range: 'low' | 'mid' | 'high'. */
function pickSpeed(pace, position) {
  if (!pace) return null;
  if (pace.value != null && pace.start == null) return pace.value * MS_TO_KMH;
  const lo = Math.min(pace.start, pace.end) * MS_TO_KMH;
  const hi = Math.max(pace.start, pace.end) * MS_TO_KMH;
  if (position === 'low') return lo;
  if (position === 'high') return hi;
  return (lo + hi) / 2;
}

/** Speed for an HR zone: the pace zone with its index, at the position within it (null without one). */
function zoneSpeed(zones, z, position) {
  const pz = z && zones.pace[Math.min(z, zones.pace.length) - 1];
  if (!pz) return null;
  const hi = Number.isFinite(pz.hi) ? pz.hi : pz.lo * 1.05;
  return pickSpeed({ start: Math.max(pz.lo, 6) / MS_TO_KMH, end: hi / MS_TO_KMH }, position);
}

/** Middle of a default pace zone, in % of threshold (Z1 ≈ 70 %). */
function zonePct(z) {
  const i = Math.min(DEFAULT_PACE_PCT.length, Math.max(1, Math.round(z))) - 1;
  const lo = i ? DEFAULT_PACE_PCT[i - 1] : 62;
  const hi = DEFAULT_PACE_PCT[i] >= 500 ? lo + 8 : DEFAULT_PACE_PCT[i];
  return (lo + hi) / 2;
}

/**
 * Relative intensity of a pace or HR target in % of threshold, [start, end].
 * Needs no profile: it draws the workout's shape before steps have a speed.
 */
export function paceIntensity(step) {
  const t = step.pace || step.hr;
  if (!t) return null;
  const a = t.start ?? t.value;
  const b = t.end ?? t.value;
  if (a == null) return null;
  if (t.units === '%pace') return [a, b];
  if (t.units === 'pace_zone' || t.units === 'hr_zone') return [zonePct(a), zonePct(b)];
  // HR in % of LTHR or max HR: rough approximation, only for the shape
  if (t.units === '%lthr') return [a, b];
  if (t.units === '%hr') return [a * 1.1, b * 1.1];
  return null;
}

function describePace(pace) {
  if (!pace) return '';
  if (pace.units === 'pace_zone') return t('step.zonePace', { zone: pace.value });
  if (pace.units === '%pace') {
    return t('step.pctPace', { pct: pace.start != null ? `${pace.start}–${pace.end}` : pace.value });
  }
  return '';
}

/**
 * Speed (km/h, not limited to any treadmill), HR range, zone, label and
 * intensity of a running step. See flattenWorkout in steps.js for the HR modes.
 */
export function runTargets(step, { position = 'mid', zones = null, hrTargets = false } = {}) {
  const pace = step._pace;
  let speedStart = null;
  let speedEnd = null;
  if (pace && step.ramp && pace.start != null) {
    speedStart = pace.start * MS_TO_KMH;
    speedEnd = pace.end * MS_TO_KMH;
  } else {
    speedStart = speedEnd = pickSpeed(pace, position);
  }

  let hr = null;
  let hrLabel = '';
  let zone = null;
  const hrRange = hrTargetRange(zones, step.hr, step._hr);
  if (hrRange) {
    const z = hrZoneOf(zones, Math.round((hrRange.lo + hrRange.hi) / 2));
    zone = z;
    // A ramp climbs from the bottom of its range to the top, zone by zone
    const zFrom = step.ramp ? hrZoneOf(zones, hrRange.lo) : z;
    const zTo = step.ramp ? hrZoneOf(zones, hrRange.hi) : z;
    if (speedStart == null) {
      // Starting speed: the pace zone in the same position
      speedStart = zoneSpeed(zones, zFrom, position);
      speedEnd = zoneSpeed(zones, zTo, position);
    }
    // lockSpeed: HR is only the step's goal; speed is left alone
    const byIncline = step.hrBy === 'incline' && !step.lockSpeed;
    // A ramp with a speed keeps its shape (HR lags behind it): HR only caps it
    const mode = step.lockSpeed ? 'info' : step.ramp && speedStart != null && !byIncline ? 'cap' : 'target';
    hr = { ...hrRange, mode, ...(byIncline && { by: 'incline' }) };
    const zLabel = zFrom !== zTo ? `Z${zFrom}→Z${zTo}` : z ? `Z${z}` : '';
    hrLabel = step.lockSpeed
      ? t('step.hrGoal', { range: zLabel || `${hrRange.lo}–${hrRange.hi}` })
      : t('step.hrRange', { range: `${hrRange.lo}–${hrRange.hi}${zLabel ? ` (${zLabel})` : ''}` }) + (byIncline ? ` ${t('step.byIncline')}` : '');
  } else if (speedStart != null && zones?.hr.length) {
    const pz = paceZoneOf(zones, Math.max(speedStart, speedEnd));
    zone = pz;
    const hz = zones.hr[Math.min(pz, zones.hr.length) - 1];
    const edge = step.warmup || step.cooldown;
    if (!hz || step.lockSpeed) hr = null;
    else if (!hrTargets || edge) hr = { lo: hz.lo, hi: hz.hi, mode: 'cap' };
    else if (pz <= 4 && (step.duration || 0) >= HR_STEP_MIN_S) {
      hr = { lo: hz.lo, hi: hz.hi, mode: 'target', ...(pz >= 3 && { settle: HR_SETTLE_S }) };
      hrLabel = t('step.hrRange', { range: `${hz.lo}–${hz.hi} (Z${pz})` });
    }
  }

  const label = hrLabel || describePace(step.pace) ||
    (speedStart != null ? t('step.pace', { pace: formatPace(speedStart) }) : step.hr ? t('step.hrTarget') : t('common.free'));
  return { speedStart, speedEnd, hr, zone, label, intensity: paceIntensity(step) };
}

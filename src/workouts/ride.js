/**
 * Cycling step targets: watts from the cycling zones (or what Intervals.icu
 * resolved), the power zone, the HR range HR control follows, label and
 * intensity. The HR rules mirror running (run.js), with power as the
 * actuator: a step with an HR target follows it (starting from the matching
 * power zone), and a power step gets the HR zone in the same position as a
 * cap, or as a target on long aerobic steps when HR adjustment is on.
 */
import { hrTargetRange, hrZoneOf, DEFAULT_POWER_PCT } from '../physiology/zones.js';
import { paceIntensity, HR_STEP_MIN_S, HR_SETTLE_S } from './run.js';
import { t } from '../i18n/index.js';

/** Middle of a default power zone, in % of FTP. */
function powerZonePct(z) {
  const i = Math.min(DEFAULT_POWER_PCT.length, Math.max(1, Math.round(z))) - 1;
  const lo = i ? DEFAULT_POWER_PCT[i - 1] : 40;
  const hi = DEFAULT_POWER_PCT[i] >= 500 ? lo + 30 : DEFAULT_POWER_PCT[i];
  return (lo + hi) / 2;
}

/** Relative intensity of a power target in % of FTP, [start, end]; null for watts. */
function powerIntensity(step) {
  const p = step.power;
  if (!p || (p.start ?? p.value) == null) return null;
  const a = p.start ?? p.value;
  const b = p.end ?? p.value;
  if (p.units === '%ftp') return [a, b];
  if (p.units === 'power_zone') return [powerZonePct(a), powerZonePct(b)];
  return null;
}

/**
 * Power target of a bike step in watts { lo, hi }, from the cycling zones
 * (zones.power, zones.ftp) or, without them, what Intervals.icu resolved.
 */
function powerRange(step, zones) {
  const p = step.power;
  if (!p) return null;
  const a = p.start ?? p.value;
  const b = p.end ?? p.value;
  if (a != null) {
    if (p.units === 'w') return { lo: Math.round(a), hi: Math.round(b) };
    if (p.units === '%ftp' && zones?.ftp) return { lo: Math.round((a / 100) * zones.ftp), hi: Math.round((b / 100) * zones.ftp) };
    if (p.units === 'power_zone' && zones?.power?.length) {
      const zl = zones.power[Math.round(a) - 1];
      const zh = zones.power[Math.round(b) - 1];
      if (zl && zh) return { lo: zl.lo, hi: Number.isFinite(zh.hi) ? zh.hi : Math.round(zh.lo * 1.2) };
    }
  }
  const r = step._power;
  if (r && (r.start ?? r.value) != null) return { lo: Math.round(r.start ?? r.value), hi: Math.round(r.end ?? r.value) };
  return null;
}

/** Power zone (1..n) of a wattage. */
function powerZoneOf(zones, w) {
  if (!zones?.power?.length || w == null) return null;
  const z = zones.power.find((p) => w <= p.hi);
  return z ? z.z : zones.power.length;
}

function describePower(power, watts) {
  if (!power) return '';
  const w = watts ? ` (${watts.lo === watts.hi ? watts.lo : `${watts.lo}–${watts.hi}`} W)` : '';
  if (power.units === 'power_zone') return t('step.zonePower', { zone: power.start != null ? `${power.start}–${power.end}` : power.value }) + w;
  if (power.units === '%ftp') return t('step.pctFtp', { pct: power.start != null ? `${power.start}–${power.end}` : power.value }) + w;
  return watts ? `${watts.lo === watts.hi ? watts.lo : `${watts.lo}–${watts.hi}`} W` : '';
}

/** HR zone (of `zones.hr`) in the same position as a power zone: Z1–Z4 alike, Z5 and up the top HR zone. */
const hrZoneFor = (zones, powerZone) => zones?.hr?.[Math.min(powerZone, zones.hr.length) - 1] ?? null;

/**
 * Watts, power zone, HR range and mode, label and intensity of a bike step.
 * See flattenWorkout in steps.js for the HR modes (hrTargets: HR adjustment on).
 */
export function rideTargets(step, { zones = null, hrTargets = false } = {}) {
  let power = powerRange(step, zones);
  let zone = null;
  if (power) zone = powerZoneOf(zones, (power.lo + power.hi) / 2);
  else if (step.power?.units === 'power_zone') zone = Math.round(step.power.start ?? step.power.value) || null;
  else if (step.power?.units === '%ftp') {
    const pct = Math.max(step.power.start ?? step.power.value, step.power.end ?? step.power.value);
    zone = DEFAULT_POWER_PCT.findIndex((top) => pct <= top) + 1 || DEFAULT_POWER_PCT.length;
  }

  let hr = null;
  let hrLabel = '';
  const hrRange = hrTargetRange(zones, step.hr, step._hr);
  if (hrRange) {
    // lockSpeed: HR is only the step's goal; watts are left alone
    hr = { ...hrRange, mode: step.lockSpeed ? 'info' : 'target' };
    const z = hrZoneOf(zones, Math.round((hrRange.lo + hrRange.hi) / 2));
    const range = step.lockSpeed ? (z ? `Z${z}` : `${hrRange.lo}–${hrRange.hi}`) : `${hrRange.lo}–${hrRange.hi}${z ? ` (Z${z})` : ''}`;
    hrLabel = t(step.lockSpeed ? 'step.hrGoal' : 'step.hrRange', { range });
    if (!power && z && zones?.power?.length) {
      // Starting watts: the power zone in the same position
      const pz = zones.power[Math.min(z, zones.power.length) - 1];
      power = { lo: pz.lo, hi: Number.isFinite(pz.hi) ? pz.hi : Math.round(pz.lo * 1.2) };
      zone = pz.z ?? z;
    }
  } else if (power && zone != null && zones?.hr?.length && !step.lockSpeed) {
    const hz = hrZoneFor(zones, zone);
    const edge = step.warmup || step.cooldown;
    if (!hz) hr = null;
    else if (!hrTargets || edge) hr = { lo: hz.lo, hi: hz.hi, mode: 'cap' };
    else if (zone <= 4 && (step.duration || 0) >= HR_STEP_MIN_S) {
      hr = { lo: hz.lo, hi: hz.hi, mode: 'target', ...(zone >= 3 && { settle: HR_SETTLE_S }) };
      hrLabel = t('step.hrRange', { range: `${hz.lo}–${hz.hi} (Z${Math.min(zone, zones.hr.length)})` });
    }
  }
  const label = hrLabel || describePower(step.power, power) || (step.hr ? t('step.hrTarget') : t('common.free'));
  // Watts without a % become % of FTP, so the chart can draw the shape
  const intensity = powerIntensity(step) ?? paceIntensity(step) ??
    (power && zones?.ftp ? [(power.lo / zones.ftp) * 100, (power.hi / zones.ftp) * 100] : null);
  return { power, zone, hr, label, intensity };
}

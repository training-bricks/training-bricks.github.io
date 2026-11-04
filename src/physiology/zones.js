/**
 * Athlete profile and HR / pace zones.
 *
 * The profile stores three numbers (threshold pace, LTHR, max HR) and the
 * percentages of each zone. Zones in bpm and km/h are always computed from
 * them, so editing the threshold or LTHR by hand moves every zone with it.
 *
 * Intervals.icu stores HR zones as each zone's top in bpm and pace zones as
 * the top in % of threshold speed (more % = faster; the last one is usually
 * 999). On load they are converted to % of LTHR.
 *
 * Cycling zones (`profile.ride`) come from the Ride sport-settings as they
 * are: power zones in % of FTP and HR zones in bpm.
 */

const MS_TO_KMH = 3.6;

/** Default percentages: Intervals.icu's running defaults (Friel). */
export const DEFAULT_PACE_PCT = [77.5, 87.7, 94.3, 100, 103.4, 111.5, 999];
export const DEFAULT_HR_PCT = [80, 89, 94, 100, 102, 106, 999];
const DEFAULT_PACE_NAMES = ['Z1', 'Z2', 'Z3', 'Z4', 'Z5a', 'Z5b', 'Z5c'];
const DEFAULT_RESTING_HR = 60; // bpm, until Intervals gives one
/** Intervals.icu's default power zones (Coggan), top of each in % of FTP. */
export const DEFAULT_POWER_PCT = [55, 75, 90, 105, 120, 150, 999];

/**
 * @typedef {{thresholdKmh: number|null, lthr: number|null, maxHr: number|null,
 *            pacePct: number[], hrPct: number[], paceNames?: string[], hrNames?: string[],
 *            ride?: RideProfile|null, source: 'intervals'|'manual'}} Profile
 * @typedef {{ftp: number|null, indoorFtp: number|null, lthr: number|null, maxHr: number|null,
 *            powerPct: number[], powerNames: string[]|null, hrZones: number[], hrNames: string[]|null}} RideProfile
 */

/** Profile from Intervals.icu running sport-settings. */
export function profileFromIntervals(s) {
  const lthr = s.lthr || null;
  const maxHr = s.max_hr || null;
  const hrZones = s.hr_zones || [];
  return {
    thresholdKmh: s.threshold_pace ? Math.round(s.threshold_pace * MS_TO_KMH * 100) / 100 : null,
    lthr,
    maxHr,
    pacePct: s.pace_zones?.length ? s.pace_zones : DEFAULT_PACE_PCT,
    // The last zone reaches max HR: marked with 999
    hrPct: lthr && hrZones.length
      ? hrZones.map((bpm, i) => (i === hrZones.length - 1 ? 999 : Math.round((bpm / lthr) * 1000) / 10))
      : DEFAULT_HR_PCT,
    paceNames: s.pace_zone_names || DEFAULT_PACE_NAMES,
    hrNames: s.hr_zone_names || null,
    source: 'intervals',
  };
}

/** Cycling part of the profile from the Ride sport-settings (null without them). */
export function rideFromIntervals(s) {
  if (!s) return null;
  return {
    ftp: s.ftp || null,
    indoorFtp: s.indoor_ftp || null,
    lthr: s.lthr || null,
    maxHr: s.max_hr || null,
    powerPct: s.power_zones?.length ? s.power_zones : DEFAULT_POWER_PCT,
    powerNames: s.power_zone_names || null,
    hrZones: s.hr_zones || [],
    hrNames: s.hr_zone_names || null,
  };
}

/**
 * The cycling settings with a bike test's VT2 (#40): its watts as the indoor
 * FTP (the one Brickwise rides by) and its HR as LTHR. The HR zones stay as
 * they are in bpm. From null, settings with only those two.
 */
export function rideWithVt2(ride, vt2) {
  return ride ? { ...ride, indoorFtp: vt2.w, lthr: vt2.hr } : { ...rideFromIntervals({ lthr: vt2.hr }), indoorFtp: vt2.w };
}

/**
 * Cycling zones in watts and bpm. Power uses the indoor FTP when there is one
 * (Brickwise rides on a trainer).
 * @returns {{ftp, lthr, maxHr, power: Array<{z,name,lo,hi}>, hr: Array<{z,name,lo,hi}>} | null}
 */
export function rideZones(r) {
  if (!r) return null;
  const ftp = r.indoorFtp || r.ftp;
  const powerTops = ftp ? r.powerPct.map((pct) => (pct >= 500 ? Infinity : Math.round((pct / 100) * ftp))) : [];
  const power = powerTops.map((hi, i) => ({
    z: i + 1,
    name: r.powerNames?.[i] || `Z${i + 1}`,
    lo: i ? powerTops[i - 1] + 1 : 0,
    hi,
  }));
  const hr = r.hrZones.map((hi, i) => ({
    z: i + 1,
    name: r.hrNames?.[i] || `Z${i + 1}`,
    lo: i ? r.hrZones[i - 1] + 1 : 0,
    hi,
  }));
  return { ftp, lthr: r.lthr, maxHr: r.maxHr, power, hr };
}

/**
 * Zones in bpm and km/h from the profile.
 * @returns {{hr: Array<{z,name,lo,hi}>, pace: Array<{z,name,lo,hi}>, lthr, maxHr, thresholdKmh} | null}
 */
export function zonesFromProfile(p) {
  if (!p) return null;
  const lthr = p.lthr || (p.maxHr ? Math.round(p.maxHr * 0.91) : null);
  const maxHr = p.maxHr || (lthr ? Math.round(lthr * 1.1) : null);
  const hrTops = lthr
    ? p.hrPct.map((pct) => (pct >= 500 ? maxHr : Math.min(maxHr, Math.round((pct / 100) * lthr))))
    : [];
  const hr = hrTops.map((hi, i) => ({
    z: i + 1,
    name: p.hrNames?.[i] || `Z${i + 1}`,
    lo: i ? hrTops[i - 1] + 1 : 0,
    hi,
  }));
  const t = p.thresholdKmh;
  const pace = t
    ? p.pacePct.map((pct, i, arr) => ({
        z: i + 1,
        name: p.paceNames?.[i] || `Z${i + 1}`,
        lo: i ? (arr[i - 1] / 100) * t : 0,
        hi: pct >= 500 ? Infinity : (pct / 100) * t,
      }))
    : [];
  return { hr, pace, lthr, maxHr, thresholdKmh: t, ride: rideZones(p.ride) };
}

/**
 * Where Z1 starts, from the resting HR: below it there is a Z0, and each takes
 * half of the way from rest to Z2 (rest 50, Z2 from 130: Z0 50–90, Z1 90–130).
 * Zones from Intervals have no bottom, and 0 bpm is no target to aim at.
 */
function withZ1Floor(hr, rest) {
  if (!(hr?.length >= 2)) return hr;
  const from = hr[1].lo;
  const floor = Math.round(((rest > 0 && rest < from ? rest : DEFAULT_RESTING_HR) + from) / 2);
  return [{ ...hr[0], lo: floor }, ...hr.slice(1)];
}

/** The zones (running and cycling) with the bottom of Z1 set from the resting HR. */
export function withRestingHr(zones, rest) {
  if (!zones) return zones;
  return { ...zones, hr: withZ1Floor(zones.hr, rest), ride: zones.ride && { ...zones.ride, hr: withZ1Floor(zones.ride.hr, rest) } };
}

/** Pace zone (1..n) a speed belongs to. */
export function paceZoneOf(zones, kmh) {
  if (!zones?.pace.length || kmh == null) return null;
  const z = zones.pace.find((p) => kmh <= p.hi + 1e-6);
  return z ? z.z : zones.pace.length;
}

/** Power zone (1..n) a wattage belongs to. */
export function powerZoneOf(zones, watts) {
  if (!zones?.power?.length || !(watts > 0)) return null;
  const z = zones.power.find((p) => watts <= p.hi);
  return z ? z.z : zones.power.length;
}

/** HR range [lo, hi] of an Intervals step's `hr` target. */
export function hrTargetRange(zones, hr, resolved) {
  if (hr && zones?.hr.length) {
    // With our own zones it is recomputed, so the profile wins over what Intervals resolved
    const lo = hr.start ?? hr.value;
    const hi = hr.end ?? hr.value;
    if (hr.units === 'hr_zone') {
      const zl = zones.hr[Math.round(lo) - 1];
      const zh = zones.hr[Math.round(hi) - 1];
      if (zl && zh) return { lo: zl.lo, hi: zh.hi };
    }
    const ref = hr.units === '%lthr' ? zones.lthr : hr.units === '%hr' ? zones.maxHr : null;
    if (ref) return widen((lo / 100) * ref, (hi / 100) * ref);
  }
  if (resolved && (resolved.start != null || resolved.value != null)) {
    const a = resolved.start ?? resolved.value;
    const b = resolved.end ?? resolved.value;
    return widen(Math.min(a, b), Math.max(a, b));
  }
  return null;
}

/** A single-value target becomes a ±3 bpm range. */
function widen(lo, hi) {
  lo = Math.round(lo);
  hi = Math.round(hi);
  return hi - lo < 4 ? { lo: lo - 3, hi: hi + 3 } : { lo, hi };
}

/** HR zone (1..n) a heart rate belongs to. */
export function hrZoneOf(zones, bpm) {
  if (!zones?.hr.length || !bpm) return null;
  const z = zones.hr.find((h) => bpm <= h.hi);
  return z ? z.z : zones.hr.length;
}

/**
 * A running step written with a power target: Intervals.icu uses the
 * athlete's default target when a step only says "z2", and that can be power
 * ("caco 9+1", 2026-10-31: every step in power zones, so the treadmill had no
 * speed, #31). The pace in the same position takes its place: power Z2 → pace
 * Z2, % of FTP → the same % of threshold pace. Absolute watts have no pace:
 * the step is left free. Steps that also carry a pace or HR keep those.
 */
export function runStepFromPower(step) {
  const p = step.power;
  if (!p) return step;
  const { power, _power, ...rest } = step;
  if (step.pace || step.hr) return rest;
  const units = { power_zone: 'pace_zone', '%ftp': '%pace' }[p.units];
  return units ? { ...rest, pace: { ...p, units } } : rest;
}

/**
 * Recomputes `_pace` (m/s) of steps with a relative pace (% of threshold or a
 * zone) from the profile. Absolute paces are kept. Used for library workouts
 * (which come unresolved) and so Intervals workouts use the profile's
 * threshold if it was edited by hand. On a run (`sport` 'run'), power
 * targets become paces first (runStepFromPower).
 */
export function resolveDoc(doc, zones, sport = null) {
  if (!doc) return doc;
  const run = sport === 'run';
  if (!zones?.thresholdKmh && !run) return doc;
  const t = zones?.thresholdKmh ? zones.thresholdKmh / MS_TO_KMH : null; // m/s
  const walk = (steps) => steps.map((original) => {
    if (original.steps) return { ...original, steps: walk(original.steps) };
    const step = run ? runStepFromPower(original) : original;
    const pace = step.pace;
    if (!t || !pace) return step;
    const lo = pace.start ?? pace.value;
    const hi = pace.end ?? pace.value;
    if (pace.units === '%pace') {
      return { ...step, _pace: pace.start != null ? { start: (lo / 100) * t, end: (hi / 100) * t } : { value: (lo / 100) * t } };
    }
    if (pace.units === 'pace_zone') {
      const zl = zones.pace[Math.round(lo) - 1];
      const zh = zones.pace[Math.round(hi) - 1];
      if (!zl || !zh) return step;
      const top = Number.isFinite(zh.hi) ? zh.hi : zh.lo * 1.05;
      return { ...step, _pace: { start: Math.max(zl.lo, zl.hi * 0.85) / MS_TO_KMH, end: top / MS_TO_KMH } };
    }
    return step;
  });
  return { ...doc, steps: walk(doc.steps || []) };
}

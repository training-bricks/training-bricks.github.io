/**
 * Workout library: turns the recipes in data/library.json into Intervals.icu
 * workout_docs, for every duration (30, 45, 60 min) and level (1–5).
 *
 * To add or tweak workouts only data/library.json is edited; the format is in
 * the wiki, "Workout library format". Paces are in % of threshold or zones (adapted
 * to the profile by zones.resolveDoc) or fixed min/km. Bike workouts (types
 * and featured entries with "sport": "ride") use power in % of FTP or power
 * zones instead (watts come from the cycling profile, workouts/ride.js).
 */

/** "2m", "1m30s", "90s" → seconds. */
export function parseDur(text) {
  if (typeof text === 'number') return text;
  const m = String(text).trim().match(/^(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2])) throw new Error(`Invalid duration: "${text}"`);
  return Math.round(Number(m[1] || 0) * 60 + Number(m[2] || 0));
}

/** 90 → "1′30″" */
export function fmtDur(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m ? `${m}′` : ''}${s}″` : `${m}′`;
}

/** Pace target: 72 or [104, 108] (% of threshold), "Z2" (zone) or "12:00" (fixed min/km). */
function paceTarget(pace) {
  if (pace == null) return {};
  if (Array.isArray(pace)) return { pace: { units: '%pace', start: pace[0], end: pace[1] } };
  if (typeof pace === 'number') return { pace: { units: '%pace', value: pace } };
  const zone = String(pace).match(/^Z(\d)$/i);
  if (zone) return { pace: { units: 'pace_zone', value: Number(zone[1]) } };
  const abs = String(pace).match(/^(\d{1,2}):([0-5]\d)$/);
  if (abs) {
    const sec = Number(abs[1]) * 60 + Number(abs[2]);
    // Already resolved: does not depend on the profile
    return { pace: { units: 'secs/km', value: sec }, _pace: { value: 1000 / sec } };
  }
  throw new Error(`Invalid pace: "${pace}"`);
}

/** Power target of a bike segment: 70 or [55, 75] (% of FTP), or "Z2" (power zone). */
function powerTarget(power) {
  if (power == null) return {};
  if (Array.isArray(power)) return { power: { units: '%ftp', start: power[0], end: power[1] } };
  if (typeof power === 'number') return { power: { units: '%ftp', value: power } };
  const zone = String(power).match(/^Z(\d)$/i);
  if (zone) return { power: { units: 'power_zone', value: Number(zone[1]) } };
  throw new Error(`Invalid power: "${power}"`);
}

function powerText(power) {
  if (Array.isArray(power)) return `at ${power[0]}–${power[1]} % FTP`;
  if (typeof power === 'number') return `at ${power} % FTP`;
  return `in power ${String(power).toUpperCase()}`;
}

/** How a segment's target reads in a summary: power on a bike, pace on foot. */
const targetText = (seg) => (seg.power != null ? powerText(seg.power) : paceText(seg.pace));

function paceText(pace) {
  if (Array.isArray(pace)) return `at ${pace[0]}–${pace[1]} %`;
  if (typeof pace === 'number') return `at ${pace} %`;
  if (/^Z\d$/i.test(pace)) return `in ${pace.toUpperCase()}`;
  return `at ${pace}/km`;
}

/** A library.json segment → workout_doc step. */
function toStep(seg, extra = {}) {
  const step = { duration: parseDur(seg.dur), ...paceTarget(seg.pace), ...powerTarget(seg.power), ...extra };
  if (seg.hr) step.hr = { units: 'hr_zone', value: Number(String(seg.hr).replace(/^Z/i, '')) };
  if (seg.ramp) step.ramp = true;
  if (seg.lock) step.lockSpeed = true;
  if (seg.warmup) step.warmup = true;
  if (seg.cooldown) step.cooldown = true;
  if (seg.hrBy) step.hrBy = seg.hrBy;
  if (seg.test) step.test = true;
  if (seg.incline != null) step.text = `incl ${seg.incline}%`;
  return step;
}

/** Main set of a recipe in `sec` seconds: { steps, summary, extra } (extra: leftover time). */
function mainSet(level, sec) {
  if (level.kind === 'continuous') {
    const steps = [];
    let main = sec;
    let finish = null;
    if (level.finish) {
      const f = level.finish;
      const unit = parseDur(f.work.dur) + parseDur(f.recovery.dur);
      finish = { reps: f.reps, steps: [toStep(f.work), toStep(f.recovery)] };
      main -= f.reps * unit;
    }
    steps.push(toStep({ ...level.main, dur: main }));
    if (finish) steps.push(finish);
    return { steps, summary: level.summary || `${fmtDur(main)} ${targetText(level.main)}`, extra: 0 };
  }

  if (level.kind === 'intervals') {
    const work = parseDur(level.work.dur);
    const rec = parseDur(level.recovery.dur);
    // fixed reps, or as many as fit, up to maxReps. Each one carries its
    // recovery; the last one's may eat into the start of the cooldown
    const fit = Math.floor((sec + rec) / (work + rec));
    let reps = Math.min(fit, level.reps || level.maxReps || fit);
    reps = Math.max(1, reps);
    const used = reps * (work + rec);
    const steps = [{ reps, steps: [toStep(level.work), toStep(level.recovery)] }];
    const incl = level.work.incline != null ? ` with ${level.work.incline} %` : '';
    const summary = level.summary || `${reps} × ${fmtDur(work)} ${targetText(level.work)}${incl} · ${fmtDur(rec)} easy`;
    return { steps, summary, extra: sec - used };
  }

  if (level.kind === 'incline-ramp') {
    const every = parseDur(level.every);
    const seg = { pace: level.pace, hr: level.hr, lock: true };
    const steps = [];
    let left = sec;
    let incl = level.from;
    for (; incl <= level.to + 1e-9 && left >= every; incl = Math.round((incl + level.step) * 10) / 10) {
      steps.push(toStep({ ...seg, dur: every, incline: incl }));
      left -= every;
    }
    const top = Math.round((incl - level.step) * 10) / 10;
    if (left > 0) steps.push(toStep({ ...seg, dur: left, incline: top }));
    return { steps, summary: `${paceText(level.pace)}, climbs to ${top} % and holds`, extra: 0 };
  }

  throw new Error(`Unknown recipe kind: "${level.kind}"`);
}

/** Warm-up or cooldown of a type: its own, the default one, or none (null). */
function edge(type, defaults, key, minutes) {
  const k30 = `${key}30`;
  if (minutes <= 30 && type[k30] !== undefined) return type[k30];
  if (type[key] !== undefined) return type[key];
  if (minutes <= 30 && defaults[k30]) return defaults[k30];
  return defaults[key] || null;
}

/** A generated workout: type × duration × level. Bike types take the bike defaults (defaults.ride). */
export function buildWorkout(type, minutes, levelNum, allDefaults = {}) {
  const sport = type.sport ?? 'run';
  const defaults = sport === 'ride' ? allDefaults.ride ?? {} : allDefaults;
  // byDuration: level overrides for a specific duration (sets, reps…)
  const base = type.levels[levelNum];
  const over = base.byDuration?.[minutes] || {};
  const level = { ...base, ...over };
  for (const k of ['work', 'recovery', 'main']) if (base[k] && over[k]) level[k] = { ...base[k], ...over[k] };
  const wu = edge(type, defaults, 'warmup', minutes);
  const cd = edge(type, defaults, 'cooldown', minutes);
  const wuSec = wu ? parseDur(wu.dur) : 0;
  const cdSec = cd ? parseDur(cd.dur) : 0;
  const main = mainSet(level, minutes * 60 - wuSec - cdSec);
  // Leftover time from the sets lengthens the warm-up and cooldown (in whole minutes)
  // (if the last recovery does not fit, extra is negative and shortens the cooldown)
  const wuAdd = !cd ? main.extra : main.extra > 0 ? Math.round(main.extra / 120) * 60 : 0;
  const cdAdd = main.extra - wuAdd;
  const steps = [];
  if (wu) steps.push(toStep({ ...wu, dur: wuSec + wuAdd }, { warmup: true }));
  else if (main.extra) steps.unshift(toStep({ dur: main.extra, ...(sport === 'ride' ? { power: [55, 65] } : { pace: [70, 75] }) }));
  steps.push(...main.steps);
  if (cd) steps.push(toStep({ ...cd, dur: cdSec + cdAdd }, { cooldown: true }));
  return {
    id: `${type.id}-${minutes}-${levelNum}`,
    sport,
    type: type.id,
    typeName: type.name,
    minutes,
    level: Number(levelNum),
    name: `${type.name} · ${minutes} min · level ${levelNum}`,
    hrControl: !!(level.hrControl ?? type.hrControl),
    summary: main.summary,
    description: `${main.summary[0].toUpperCase()}${main.summary.slice(1)}. ${type.description}`,
    workout_doc: { steps },
  };
}

/** Every workout in library.json: featured first, then the generated ones. */
export function buildLibrary(json) {
  const defaults = json.defaults || {};
  const out = [];
  for (const f of json.featured || []) {
    out.push({
      id: f.id,
      sport: f.sport ?? 'run',
      type: f.type,
      typeName: json.types.find((t) => t.id === f.type)?.name || f.type,
      minutes: f.minutes,
      level: f.level,
      featured: true,
      hrControl: !!f.hrControl,
      name: f.name,
      summary: f.description,
      description: f.description,
      workout_doc: { steps: f.steps.map((s) => toStep(s)) },
    });
  }
  for (const type of json.types) {
    for (const minutes of json.durations) {
      for (const lv of Object.keys(type.levels)) out.push(buildWorkout(type, minutes, lv, defaults));
    }
  }
  return out;
}

/** Types for the filters, in file order. */
export const libraryTypes = (json) => json.types.map((t) => ({ id: t.id, name: t.name, sport: t.sport ?? 'run' }));

export async function loadLibrary(url = new URL('../../data/library.json', import.meta.url)) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not read ${url} (HTTP ${res.status})`);
  const json = await res.json();
  return { json, entries: buildLibrary(json), types: libraryTypes(json), durations: json.durations };
}

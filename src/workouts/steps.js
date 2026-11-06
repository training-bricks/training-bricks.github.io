/**
 * Turns an Intervals.icu workout_doc (fetched with resolve=true) into a flat
 * list of steps: the shared walk (repeats, labels, durations, incline) here,
 * the targets per sport in run.js and ride.js. Targets are the plan as
 * written, not limited to any device: the session clamps what it sends to
 * the connected treadmill's limits.
 *
 * With resolve=true every step carries `_pace` in m/s ({start, end} for a
 * range or {value} for a fixed value), so the zones are not needed.
 *
 * @typedef {object} Step   common to both sports
 * @property {string} label @property {string} text @property {'Warm-up'|'Work'|'Cooldown'} kind
 * @property {number|null} duration   s @property {number|null} distance   m
 * @property {boolean} hasTarget      a speed to follow (run)
 * @property {boolean} ramp @property {boolean} warmup @property {boolean} test
 * @property {number} incline         % (plan; clamped when sent)
 * @property {[number, number]|null} intensity   % of threshold, for the chart shape
 * @property {number|null} zone       pace zone (HR zone for an HR target, power zone on a bike)
 * @property {{lo: number, hi: number, mode: 'cap'|'target'|'info', by?: 'incline', settle?: number}|null} hr
 *
 * @typedef {Step & { speedStart: number|null, speedEnd: number|null, power: null }} RunStep   km/h
 * @typedef {Step & { speedStart: null, speedEnd: null, power: {lo: number, hi: number}|null }} RideStep   W
 */

import { runTargets, HR_STEP_MIN_S } from './run.js';
import { rideTargets } from './ride.js';
import { t } from '../i18n/index.js';

export { HR_STEP_MIN_S } from './run.js';
export { formatPace, formatDuration } from './format.js';

const round1 = (v) => Math.round(v * 10) / 10;

/** Incline written in the step text, e.g. "incline 2%", "2% incl", "inclinación 3". */
function parseIncline(text) {
  if (!text) return null;
  const m =
    text.match(/incl\p{L}*\.?\s*(-?\d+(?:[.,]\d+)?)\s*%?/iu) ||
    text.match(/(-?\d+(?:[.,]\d+)?)\s*%\s*incl/iu);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

/**
 * @param {object} doc       resolved workout_doc
 * @param {object} opts      { position: 'low'|'mid'|'high', defaultIncline: number, zones, hrTargets }
 *
 * With zones (physiology/zones.js) every running step also carries `hr` = { lo, hi, mode }:
 * - mode 'cap':    step with a pace target; hi is the top of the matching HR
 *                  zone (same position as the pace zone).
 * - mode 'target': step with an HR target; the starting speed comes from the
 *                  matching pace zone and is then adjusted by HR.
 * - mode 'info':   step with lockSpeed (or a bike step); the HR range is only displayed.
 * An HR target with `hrBy: 'incline'` keeps the speed and moves the incline
 * instead (hr.by = 'incline').
 *
 * hrTargets (the workout follows HR): steps of HR_STEP_MIN_S or more in pace
 * Z1–Z4 become 'target' steps on the HR zone with the same index, starting at
 * their pace. Shorter steps (reps, recoveries, strides) keep their pace and get
 * no HR control; warm-up and cooldown keep the cap.
 *
 * Steps with a power target are bike steps (ride.js); the rest are running steps (run.js).
 *
 * @returns {Array<RunStep | RideStep>}
 */
export function flattenWorkout(doc, { position = 'mid', defaultIncline = 1, zones = null, hrTargets = false } = {}) {
  const out = [];

  const walk = (steps, path) => {
    steps.forEach((step) => {
      if (step.steps && step.steps.length) {
        const reps = step.reps || 1;
        for (let r = 1; r <= reps; r++) {
          walk(step.steps, [...path, reps > 1 ? `${r}/${reps}` : null].filter(Boolean));
        }
        return;
      }

      const targets = step.power
        ? { speedStart: null, speedEnd: null, ...rideTargets(step, { zones, hrTargets }) }
        : { power: null, ...runTargets(step, { position, zones, hrTargets }) };
      const kind = step.warmup ? 'Warm-up' : step.cooldown ? 'Cooldown' : 'Work'; // also an id (followsHr)

      out.push({
        label: [t(`step.kind.${kind}`), ...path, targets.label].join(' · '),
        text: step.text || '',
        kind,
        duration: step.duration || null,              // s
        distance: step.duration ? null : step.distance || null, // m
        speedStart: targets.speedStart != null ? round1(targets.speedStart) : null,
        speedEnd: targets.speedEnd != null ? round1(targets.speedEnd) : null,
        incline: parseIncline(step.text) ?? defaultIncline,
        hasTarget: targets.speedStart != null,
        walk: !!targets.walk,
        ramp: !!step.ramp,
        warmup: !!step.warmup,
        cooldown: !!step.cooldown,
        test: !!step.test,
        hr: targets.hr,
        power: targets.power,  // bike steps: { lo, hi } W
        intensity: targets.intensity,
        zone: targets.zone,    // pace zone (HR zone for an HR target, power zone on a bike), to color the chart
        zoneStart: targets.zoneStart ?? targets.zone, // where a ramp starts and ends: a step starting in the zone
        zoneEnd: targets.zoneEnd ?? targets.zone,     // the one before ended in keeps its pace
      });
    });
  };

  walk(doc?.steps || [], []);
  return out;
}

/**
 * Whether a workout (flattened without hrTargets) is one HR can steer, for
 * workouts that carry no hrControl flag (Intervals.icu): it has an HR target,
 * or long aerobic/tempo steps (Z1–Z3) and only easy steps (Z1–Z2) between them.
 */
export function followsHr(steps) {
  if (steps.some((s) => s.hr?.mode === 'target')) return true;
  const main = steps.filter((s) => s.kind === 'Work' && (s.hasTarget || s.power));
  const long = main.filter((s) => (s.duration || 0) >= HR_STEP_MIN_S);
  return long.length > 0 &&
    main.every((s) => s.zone != null && s.zone <= (long.includes(s) ? 3 : 2));
}

/**
 * An HR target with no speed to start from (no threshold pace in the profile):
 * HR finds the speed, from wherever the belt is (session/runner.js).
 */
export const searchesSpeed = (step) => step?.hr?.mode === 'target' && !step.hasTarget && !step.power && step.hr.by !== 'incline';

/** Target speed within a step for a given progress (0..1), with ramps. */
export function targetSpeedAt(step, progress) {
  if (!step.hasTarget) return null;
  if (!step.ramp) return step.speedStart;
  const p = Math.min(1, Math.max(0, progress));
  return round1(step.speedStart + (step.speedEnd - step.speedStart) * p);
}

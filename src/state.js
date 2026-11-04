/**
 * App-wide state: the profile and its zones, the workout picked, the
 * connected devices and the Intervals.icu account. No DOM and no UI imports:
 * screens and the session engine read it, and the screen that owns each part
 * sets it through the functions below (persistence stays with that screen).
 * on(name, fn) is called after each change: 'profile', 'selection',
 * 'device', 'athlete', 'wellness', 'planned', 'library', 'options'.
 */
import { zonesFromProfile, withRestingHr } from './physiology/zones.js';
import { createEmitter } from './lib/events.js';

export const state = {
  profile: null,     // see physiology/zones.js
  zones: null,       // computed from the profile
  selection: null,   // { key, event, steps, needsProfile, hrControl, hrOn }; null = manual control
  devices: { treadmill: null, trainer: null, hr: null, sensors: [] },
  athlete: null,     // Intervals.icu account
  wellness: null,    // latest weight, sleep, resting HR, HRV
  planned: null,     // the day's Intervals.icu workouts (null = not loaded)
  library: { entries: [], loaded: false },   // data/library.json (loaded: done, even if it failed)
  workoutOptions: { position: 'mid', defaultIncline: 1, hrAdjust: true, alphaGuard: true },  // workout page choices
};

const emitter = createEmitter();
export const on = emitter.on;
const emit = emitter.emit;

const restingHr = () => state.wellness?.restingHr?.value ?? state.athlete?.restingHr ?? null;

export function setProfile(p) {
  state.profile = p;
  state.zones = p ? withRestingHr(zonesFromProfile(p), restingHr()) : null;
  emit('profile', state.profile);
}

/** Runs a change of the account; a new resting HR moves the bottom of Z1, so the zones are redone. */
function keepingZones(change) {
  const before = restingHr();
  change();
  if (restingHr() !== before && state.profile) setProfile(state.profile);
}

export function setSelection(sel) {
  state.selection = sel;
  emit('selection', sel);
}

/** kind: 'treadmill', 'trainer' or 'hr' (one device of each). */
export function setDevice(kind, device) {
  state.devices[kind] = device;
  emit('device', { kind, device });
}

export function setAthlete(a) {
  keepingZones(() => { state.athlete = a; });
  emit('athlete', a);
}

export function setWellness(w) {
  keepingZones(() => { state.wellness = w; });
  emit('wellness', w);
}

export function setPlanned(list) {
  state.planned = list;
  emit('planned', list);
}

export function setLibrary(entries) {
  state.library = { entries, loaded: true };
  emit('library', state.library);
}

export function setWorkoutOptions(o) {
  state.workoutOptions = { ...state.workoutOptions, ...o };
  emit('options', state.workoutOptions);
}

/**
 * Zones a workout is planned against: the running ones, or for a bike workout
 * the cycling ones (HR and power, no pace). Null without them.
 */
export function zonesForEvent(zones, event) {
  if (event?.sport !== 'ride') return zones ?? null;
  const r = zones?.ride;
  return r ? { hr: r.hr, pace: [], power: r.power, ftp: r.ftp, lthr: r.lthr, maxHr: r.maxHr } : null;
}

export const zonesFor = (event) => zonesForEvent(state.zones, event);

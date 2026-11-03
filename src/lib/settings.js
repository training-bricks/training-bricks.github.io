/**
 * Every setting the app stores, in one list. Keys are saved with the
 * brickwise. prefix (see lib/storage.js); a name that is not listed here
 * throws, so a typo cannot quietly create a new setting.
 *
 * type: 'json' (objects, arrays) or 'text'; fallback: the value when unset;
 * store: 'session' for values that only last the visit; secret: never log,
 * show or export it.
 */
import * as storage from './storage.js';

export const SETTINGS = {
  profile:      { type: 'json' },                       // threshold pace, LTHR, max HR, cycling settings
  athlete:      { type: 'json' },                       // Intervals.icu account (name, photo, place)
  wellness:     { type: 'json' },                       // latest weight, sleep, resting HR, HRV
  tests:        { type: 'json', fallback: [] },         // threshold test history
  runs:         { type: 'json', fallback: [] },         // steady aerobic runs with their metrics (#4)
  libFilter:    { type: 'json', fallback: {} },         // library filters
  tab:          { type: 'text' },                       // last tab or page shown
  workout:      { type: 'text' },                       // last library workout picked
  homeSport:    { type: 'text', fallback: 'all' },      // Home sport filter
  theme:        { type: 'text', fallback: 'system' },   // color palette (also read early by index.html)
  lang:         { type: 'text', fallback: 'system' },   // interface language ('system': the browser's)
  lastDevice:   { type: 'json', fallback: {} },         // last device connected per kind: { treadmill: { driver, name } }
  uploadSummary: { type: 'json', fallback: true },      // session summary in the activity description (#35)
  intervalsKey: { type: 'text', secret: true },         // Intervals.icu API key
  loadRetry:    { type: 'text', store: 'session' },     // app file download retries (index.html)
};

function spec(name) {
  const s = SETTINGS[name];
  if (!s) throw new Error(`unknown setting "${name}"`);
  return s;
}

export function get(name) {
  const s = spec(name);
  const fallback = s.fallback ?? null;
  const area = s.store;
  return s.type === 'json' ? storage.loadJson(name, fallback, area) : storage.loadText(name, area) ?? fallback;
}

export function set(name, value) {
  const s = spec(name);
  if (s.type === 'json') storage.saveJson(name, value, s.store);
  else storage.saveText(name, String(value), s.store);
}

export function remove(name) {
  storage.remove(name, spec(name).store);
}

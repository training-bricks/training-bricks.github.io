/**
 * Intervals.icu client running in the browser, with no backend of our own.
 *
 * The Intervals.icu API accepts cross-origin requests (CORS) with an
 * Authorization header, so the page calls it directly. The athlete types the
 * API key in Profile and it is stored only in their browser. Athlete "0" is
 * the key's owner, so their ID is not needed.
 */

import * as settings from '../lib/settings.js';

const API = 'https://intervals.icu/api/v1/athlete/0';
const RUN_TYPES = new Set(['Run', 'VirtualRun', 'TrailRun']);
const RIDE_TYPES = new Set(['Ride', 'VirtualRide', 'GravelRide', 'MountainBikeRide']);

/** 'run' | 'ride' | null for an Intervals.icu activity type. */
export function sportOf(type) {
  if (RUN_TYPES.has(type)) return 'run';
  if (RIDE_TYPES.has(type)) return 'ride';
  return null;
}

export function getApiKey() {
  return settings.get('intervalsKey') || '';
}

export function setApiKey(key) {
  // Without storage the key lasts only for this visit (memoryKey)
  if (key) settings.set('intervalsKey', key);
  else settings.remove('intervalsKey');
  memoryKey = key;
}

let memoryKey = getApiKey();

async function request(path, { method = 'GET', query, body } = {}) {
  if (!memoryKey) throw new Error('missing Intervals.icu API key (Profile tab)');
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    body,
    headers: { Authorization: `Basic ${btoa(`API_KEY:${memoryKey}`)}` },
  });
  if (res.status === 401 || res.status === 403) throw new Error('Intervals.icu rejected the API key');
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON response */ }
  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}`);
  return data;
}

/** Basic athlete data; also used to check the key. */
export async function getAthlete() {
  const a = await request('');
  return {
    id: a.id,
    name: a.name || [a.firstname, a.lastname].filter(Boolean).join(' '),
    photo: a.profile_medium || null,
    city: a.city || null,
    country: a.country || null,
    weight: a.icu_weight || null,
    restingHr: a.icu_resting_hr || null,
  };
}

/**
 * Latest wellness values of the last days (Intervals.icu keeps one record per
 * day; watches fill weight, resting HR, HRV and sleep at different times).
 * Each field comes from the most recent day that has it.
 */
export async function getWellness(oldest, newest) {
  const days = await request('/wellness', { query: { oldest, newest } });
  const latest = (k) => {
    const d = [...(days || [])].sort((a, b) => b.id.localeCompare(a.id)).find((x) => x[k] != null);
    return d ? { value: d[k], date: d.id } : null;
  };
  return {
    weight: latest('weight'),
    restingHr: latest('restingHR'),
    hrv: latest('hrv'),
    sleepSecs: latest('sleepSecs'),
    sleepScore: latest('sleepScore'),
  };
}

/** Planned runs and rides between two dates (YYYY-MM-DD), with resolved steps. */
export async function getWorkouts(oldest, newest) {
  const events = await request('/events', { query: { oldest, newest, category: 'WORKOUT', resolve: 'true' } });
  return (events || [])
    .filter((e) => sportOf(e.type) && e.workout_doc?.steps?.length)
    .map(({ id, name, start_date_local, type, description, workout_doc }) =>
      ({ id, name, start_date_local, type, sport: sportOf(type), description, workout_doc }));
}

const RUN_KEYS = ['lthr', 'max_hr', 'hr_zones', 'hr_zone_names', 'threshold_pace', 'pace_zones', 'pace_zone_names'];
const RIDE_KEYS = ['ftp', 'indoor_ftp', 'power_zones', 'power_zone_names', 'lthr', 'max_hr', 'hr_zones', 'hr_zone_names'];

/**
 * Zones from the sport-settings: `run` (HR and pace, required) and `ride`
 * (FTP, power and HR; null if the athlete has no cycling settings).
 */
export async function getSportSettings() {
  const settings = await request('/sport-settings');
  const find = (types) => (settings || []).find((s) => (s.types || []).some((t) => types.has(t)));
  const pick = (s, keys) => (s ? Object.fromEntries(keys.map((k) => [k, s[k]])) : null);
  const run = find(RUN_TYPES);
  if (!run) throw new Error('no running zones in Intervals.icu');
  return { run: pick(run, RUN_KEYS), ride: pick(find(RIDE_TYPES), RIDE_KEYS) };
}

/** Uploads a FIT file (export/fit.js) as an activity. `meta`: name, description, external_id, paired_event_id. */
export async function uploadFit(fit, meta) {
  const form = new FormData();
  form.append('file', new Blob([fit], { type: 'application/octet-stream' }), 'brickwise.fit');
  return request('/activities', {
    method: 'POST',
    query: { device_name: 'Brickwise', ...meta }, // meta.device_name: the treadmill or trainer used
    body: form,
  });
}

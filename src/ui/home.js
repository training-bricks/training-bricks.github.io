/**
 * Home: the runs and rides planned in Intervals.icu for a day, with a date
 * and a sport filter.
 */

import { $ } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import * as app from '../state.js';
import { formatDuration } from '../workouts/steps.js';
import { workoutSeconds, hrControllable } from '../workouts/info.js';
import * as intervals from '../services/intervals.js';
import { log } from './debug.js';
import { selectedKey, selectWorkout } from './selection.js';
import { t } from '../i18n/index.js';

let plannedError = null;   // why they could not be loaded, shown in the list
let homeSport = 'all';

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export async function loadWorkouts() {
  const day = $('hDate').value || today();
  $('hPlanned').entries = [{ note: t('common.loading') }];
  if (!intervals.getApiKey()) {
    app.setPlanned([]);
    renderPlanned();
    selectWorkout(selectedKey.startsWith('i:') ? 'none' : selectedKey);
    return;
  }
  plannedError = null;
  let list;
  try {
    list = await intervals.getWorkouts(day, day);
    log('info', `Intervals.icu: ${list.length} workout(s) on ${day}`);
  } catch (err) {
    list = [];
    plannedError = err.message;
    log('error', `Intervals.icu: ${err.message}`);
  }
  app.setPlanned(list);
  renderPlanned();
  // A planned pick belonged to the previous day; with nothing picked, the day's first
  let key = selectedKey.startsWith('i:') ? 'none' : selectedKey;
  if (key === 'none' && list.length) key = 'i:0';
  selectWorkout(key);
}

/** Planned workouts of the day, filtered by sport. */
function plannedEntries(sport = 'all') {
  const planned = app.state.planned;
  const shown = (planned || []).map((w, i) => [w, i]).filter(([w]) => sport === 'all' || w.sport === sport);
  const entries = shown.map(([w, i]) => {
    const sec = workoutSeconds(w.workout_doc);
    return { key: `i:${i}`, title: w.name || t('common.workout'), sub: sec ? `~${formatDuration(sec)}` : '', hrControl: hrControllable(w, app.zonesFor(w)), sport: w.sport };
  });
  if (!shown.length) {
    const none = { all: t('home.noneAll'), run: t('home.noneRun'), ride: t('home.noneRide') }[sport];
    entries.push({ note: plannedError ? t('home.loadFailed', { error: plannedError }) : planned ? none : t('common.loading') });
  }
  return entries;
}

function renderPlanned() {
  $('hPlanned').entries = plannedEntries(homeSport);
}

/** Startup: the day and the sport filter. */
export function initHome() {
  $('hDate').value = today();
  $('hDate').onchange = loadWorkouts;
  homeSport = settings.get('homeSport') || 'all';
  $('hSport').value = homeSport;
  $('hSport').onchange = () => {
    homeSport = $('hSport').value;
    settings.set('homeSport', homeSport);
    renderPlanned();
  };
  $('hReload').onclick = loadWorkouts;
  document.addEventListener('bw-language', renderPlanned);
  renderPlanned();
}

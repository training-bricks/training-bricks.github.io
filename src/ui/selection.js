/**
 * The workout picked in Home or the library: resolves its key into steps for
 * the current zones and workout page options, keeps it in the app state
 * (pages refresh on its 'selection' event) and remembers library picks.
 */

import * as settings from '../lib/settings.js';
import * as app from '../state.js';
import { flattenWorkout } from '../workouts/steps.js';
import { hrControllable } from '../workouts/info.js';
import { resolveDoc } from '../physiology/zones.js';
import { session } from '../session/runner.js';
import { showTab } from './tabs.js';

export let selectedKey = 'none';  // 'none' | 'i:<index>' | 'l:<id>'

function markSelected() {
  for (const list of document.querySelectorAll('bw-workout-list')) list.selected = selectedKey;
}

export function selectWorkout(key = selectedKey) {
  if (['armed', 'running', 'paused'].includes(session.state)) return;
  // The library is not loaded yet: keep the choice and apply it on load
  if (key.startsWith('l:') && !app.state.library.loaded) { selectedKey = key; return; }
  let event = null;
  if (key.startsWith('i:')) event = app.state.planned?.[Number(key.slice(2))] || null;
  if (key.startsWith('l:')) {
    const w = app.state.library.entries.find((x) => x.id === key.slice(2));
    if (w) event = { name: w.name, description: w.description, workout_doc: w.workout_doc, library: true, hrControl: w.hrControl, sport: w.sport };
  }
  selectedKey = event ? key : 'none';
  settings.set('workout', selectedKey.startsWith('l:') ? selectedKey : '');
  markSelected();
  if (event) {
    const ride = event.sport === 'ride';
    const z = app.zonesFor(event);
    const needsProfile = ride ? !z?.ftp : event.library && !app.state.zones?.thresholdKmh;
    const hrControl = hrControllable(event, z);
    const { position, defaultIncline, hrAdjust, alphaGuard } = app.state.workoutOptions;
    const hrOn = hrControl && hrAdjust;
    const steps = flattenWorkout(resolveDoc(event.workout_doc, z, event.sport), { position, defaultIncline, zones: z, hrTargets: hrOn });
    app.setSelection({ key, event, steps, needsProfile, hrControl, hrOn, hrOnly: hrOn && !alphaGuard });
  } else {
    app.setSelection(null);
  }
}

/** Startup: restores the saved library pick and reacts to picks, options and profile changes. */
export function initSelection() {
  const w = settings.get('workout');
  if (w?.startsWith('l:')) selectedKey = w; // confirmed once the library loads
  // A workout picked in any list opens the workout page; during a session the lists are locked
  document.addEventListener('bw-select', (e) => {
    selectWorkout(e.detail.key);
    showTab('workout');
  });
  app.on('options', () => selectWorkout());
  app.on('profile', () => selectWorkout()); // recomputes speeds and HR caps
  document.addEventListener('bw-language', () => selectWorkout()); // step labels in the new language
}

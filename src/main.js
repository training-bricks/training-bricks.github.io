import './components/icon.js';
import './components/user-card.js';
import './components/zone-table.js';
import './components/workout-list.js';
import './components/chart.js';
import './components/session-bar.js';
import { every } from './lib/timer.js';
import { loadPages } from './lib/pages.js';
import * as intervals from './services/intervals.js';
import * as settings from './lib/settings.js';
import { initDebug, log } from './ui/debug.js';
import { initDevices } from './ui/devices.js';
import { tick } from './session/runner.js';
import { initRun, updateControls } from './ui/run.js';
import { initSelection } from './ui/selection.js';
import { initWorkoutPage } from './ui/workout.js';
import { initHome, loadWorkouts } from './ui/home.js';
import { initLibrary } from './ui/library.js';
import { initRide } from './ui/ride.js';
import { initTabs, showTab } from './ui/tabs.js';
import { initConfig } from './ui/config.js';
import { initVoice } from './ui/voice.js';
import { initRecovery } from './ui/recovery.js';
import { initZoneCheck } from './ui/zone-check.js';
import { initVersion } from './ui/version.js';
import { initProfile, setProfile, loadProfileFromIntervals, renderProfile, refreshAthlete, refreshWellness } from './ui/profile.js';
import * as app from './state.js';

const TICK_MS = 250; // how often the session advances and the screen refreshes

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
// Without the pages there is no app: the same notice as a module that fails to load
try {
  await loadPages();
} catch (err) {
  window.appLoadFailed?.();
  throw err;
}
// Everything up to showTab() runs before the next paint, so the shell appears complete
document.documentElement.classList.add('app-ready');

{
  const saved = settings.get('profile');
  const tab = settings.get('tab');
  // Wiring first, then the data
  initTabs();
  // Only shows information, so a failure must not stop the app (a module older than its page, 2026-11-04)
  try {
    initVersion();
  } catch (err) {
    log('warn', `Version: ${err.message}`);
  }
  initDebug();
  initDevices();
  initRun();
  initProfile();
  initConfig();
  initVoice();
  initRide();
  initSelection();
  initWorkoutPage();
  initHome();
  initLibrary();
  if (saved?.pacePct) setProfile(saved, { save: false });
  // Without a stored profile, or one from before the cycling zones: ask Intervals.icu
  if (intervals.getApiKey() && (!saved?.pacePct || (saved.source === 'intervals' && !('ride' in saved)))) loadProfileFromIntervals();
  renderProfile();
  initZoneCheck();
  if (intervals.getApiKey() && !app.state.athlete) refreshAthlete().catch((err) => log('warn', `Intervals.icu: ${err.message}`));
  if (intervals.getApiKey()) refreshWellness().catch((err) => log('warn', `Intervals.icu wellness: ${err.message}`));
  showTab(tab || 'home');
  every(TICK_MS, tick);
  initRecovery().catch((err) => log('warn', `Session recovery: ${err.message}`));
  updateControls();
  loadWorkouts();
  settings.remove('loadRetry');
  // Installable and usable offline (sw.js); optional, so a failure is only logged
  navigator.serviceWorker?.register('sw.js').catch((err) => log('warn', `Service worker: ${err.message}`));
}

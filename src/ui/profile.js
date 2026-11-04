/**
 * Profile tab: threshold pace, LTHR and max HR (from Intervals.icu or by
 * hand), the cycling zones (FTP, power and HR, from Intervals.icu), the
 * Intervals.icu account and the threshold test history.
 */

import { $ } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import { formatDate } from '../i18n/format.js';
import * as app from '../state.js';
import { formatPace } from '../workouts/steps.js';
import { profileFromIntervals, rideFromIntervals, rideWithVt2, DEFAULT_PACE_PCT, DEFAULT_HR_PCT } from '../physiology/zones.js';
import * as intervals from '../services/intervals.js';
import { log } from './debug.js';
import { loadWorkouts } from './home.js';
import { loadTests, vtText, lastWithVt2 } from '../session/test-history.js';
import { loadRuns, decouplingText, decouplingLabel, vt1Text } from '../session/run-history.js';
import { vt1Trend } from '../physiology/aerobic.js';
import { events as sessionEvents } from '../session/runner.js';
import { t } from '../i18n/index.js';

export function setProfile(p, { save = true } = {}) {
  app.setProfile(p);
  if (save) settings.set('profile', p);
  renderProfile();
}

// The account card, in Home and Profile
const userCards = () => document.querySelectorAll('bw-user-card');

function setUserNote(text) {
  for (const card of userCards()) card.note = text;
}

export async function loadProfileFromIntervals() {
  setUserNote(t('profile.loadingZones'));
  try {
    const { run, ride } = await intervals.getSportSettings();
    setProfile({ ...profileFromIntervals(run), ride: rideFromIntervals(ride) });
    setUserNote('');
    log('info', `Intervals.icu profile: threshold ${formatPace(app.state.zones.thresholdKmh)}/km, LTHR ${app.state.zones.lthr}, max HR ${app.state.zones.maxHr}`);
    log('info', app.state.zones.ride ? `Intervals.icu cycling: FTP ${app.state.zones.ride.ftp ?? '—'} W, LTHR ${app.state.zones.ride.lthr ?? '—'}, max HR ${app.state.zones.ride.maxHr ?? '—'}` : 'Intervals.icu: no cycling settings');
  } catch (err) {
    setUserNote(t('profile.zonesFailed', { error: err.message }));
    log('warn', `Intervals.icu zones: ${err.message}`);
  }
}

// Intervals.icu account (name, photo…), stored so it is not fetched on every visit
app.setAthlete(settings.get('athlete'));

function setAthlete(a) {
  app.setAthlete(a);
  if (a) settings.set('athlete', a);
  else settings.remove('athlete');
  renderProfile();
}

function saveManualProfile() {
  const kmh = parsePace($('pPace').value);
  const lthr = parseInt($('pLthr').value, 10) || null;
  const maxHr = parseInt($('pMaxHr').value, 10) || null;
  if ($('pPace').value && !kmh) {
    $('pNote').textContent = t('profile.paceFormat');
    return;
  }
  const base = app.state.profile || { pacePct: DEFAULT_PACE_PCT, hrPct: DEFAULT_HR_PCT };
  setProfile({ ...base, thresholdKmh: kmh, lthr, maxHr, source: 'manual' });
  log('info', `Manual profile: threshold ${kmh ? `${formatPace(kmh)}/km` : '—'}, LTHR ${lthr ?? '—'}, max HR ${maxHr ?? '—'}`);
}

/** "6:10" → km/h */
function parsePace(text) {
  const m = String(text).trim().match(/^(\d{1,2}):([0-5]\d)$/);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return sec >= 120 && sec <= 1800 ? Math.round((3600 / sec) * 100) / 100 : null;
}

export function renderProfile() {
  const loggedIn = !!intervals.getApiKey();
  for (const card of userCards()) card.classList.toggle('hidden', !loggedIn);
  $('pLogin').classList.toggle('hidden', loggedIn);
  $('hLogin').classList.toggle('hidden', loggedIn);

  // Logged out: the manual form, with the current data
  $('pPace').value = app.state.zones?.thresholdKmh ? formatPace(app.state.zones.thresholdKmh) : '';
  $('pLthr').value = app.state.profile?.lthr ?? '';
  $('pMaxHr').value = app.state.profile?.maxHr ?? '';
  const src = { intervals: t('profile.fromIntervals'), manual: t('profile.byHand') }[app.state.profile?.source] || t('profile.noData');
  const derived = [];
  if (app.state.profile && !app.state.profile.lthr && app.state.zones?.lthr) derived.push(t('profile.estimatedLthr', { value: app.state.zones.lthr }));
  if (app.state.profile && !app.state.profile.maxHr && app.state.zones?.maxHr) derived.push(t('profile.estimatedMaxHr', { value: app.state.zones.maxHr }));
  $('pNote').textContent = [src, ...derived].join(' · ');

  // Logged in: the account and its data
  if (loggedIn) for (const card of userCards()) card.data = { athlete: app.state.athlete, wellness: app.state.wellness };

  renderZoneTables();
  renderTests();
  renderRuns();
}

/** Profile: running and cycling zone tables. */
function renderZoneTables() {
  $('pRunZones').data = { zones: app.state.zones };
  const r = app.state.profile?.ride;
  $('pRideZones').data = {
    zones: app.state.zones?.ride,
    note: r?.indoorFtp && r.indoorFtp !== r.ftp ? t('profile.indoorFtp', { indoor: r.indoorFtp, outdoor: r.ftp ?? '—' }) : '',
  };
}

function renderKeyState(text) {
  $('pKeyNote').textContent = text ?? '';
}

export async function refreshAthlete() {
  const a = await intervals.getAthlete();
  setAthlete(a);
  return a;
}

// Wellness (weight, resting HR, HRV, sleep): refreshed on every visit
app.setWellness(settings.get('wellness'));
const WELLNESS_DAYS = 7;

export async function refreshWellness() {
  const day = (offset) => {
    const d = new Date(Date.now() - offset * 86400000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  app.setWellness(await intervals.getWellness(day(WELLNESS_DAYS - 1), day(0)));
  settings.set('wellness', app.state.wellness);
  renderProfile();
}


const refreshAll = async () => {
  try {
    await refreshAthlete();
    await refreshWellness();
    await loadProfileFromIntervals();
    loadWorkouts();
  } catch (err) {
    setUserNote(t('profile.refreshFailed', { error: err.message }));
  }
};

const signOut = () => {
  intervals.setApiKey('');
  setAthlete(null);
  app.setWellness(null);
  settings.remove('wellness');
  // The data stays as a starting point for the manual profile
  if (app.state.profile) setProfile({ ...app.state.profile, source: 'manual' });
  log('info', 'Intervals.icu: signed out');
  loadWorkouts();
};

/** Profile: threshold test history (session/test-history.js); the latest VT2 can become LTHR and threshold pace. */
export function renderTests() {
  const tests = loadTests();
  $('pTestsCard').classList.toggle('hidden', !tests.length);
  $('pTests').replaceChildren(...tests.map((t) => {
    const tr = document.createElement('tr');
    for (const v of [formatDate(t.date), vtText(t.vt1), t.vt2 ? vtText(t.vt2) + (t.vt2.extrapolated ? ' *' : '') : '—', t.r2]) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    return tr;
  }));
  const last = lastWithVt2(tests, 'run');
  const lastRide = lastWithVt2(tests, 'ride');
  $('pTestApplyRide').classList.toggle('hidden', !lastRide);
  $('pTestsRideHelp').classList.toggle('hidden', !lastRide);
  if (lastRide) $('pTestApplyRide').textContent = t('profile.useVt2Ride', { hr: lastRide.vt2.hr, w: lastRide.vt2.w });
  $('pTestApply').classList.toggle('hidden', !last && !!lastRide);
  $('pTestApply').disabled = !last;
  $('pTestApply').textContent = last
    ? t('profile.useVt2With', { hr: last.vt2.hr, pace: formatPace(last.vt2.kmh) })
    : t('profile.useVt2');
}

/**
 * Profile: steady aerobic runs and rides with their decoupling (Pa:HR or
 * Pw:HR) and VT1 from α1 (session/run-history.js), and a VT1 trend per
 * sport: HR at VT1 is lower on the bike.
 */
export function renderRuns() {
  const runs = loadRuns();
  $('pRunsCard').classList.toggle('hidden', !runs.length);
  const trends = [['run', 'profile.vt1Trend'], ['ride', 'profile.vt1TrendRide']]
    .map(([sport, key]) => [vt1Trend(runs, 5, sport), key])
    .filter(([trend]) => trend);
  $('pRunsTrend').replaceChildren(...trends.map(([trend, key]) => {
    const line = document.createElement('div');
    line.textContent = t(key, { hr: trend.hr, n: trend.runs });
    return line;
  }));
  $('pRuns').replaceChildren(...runs.map((r) => {
    const tr = document.createElement('tr');
    const cells = [formatDate(r.date), r.name ?? t('profile.freeRun'), t('common.minutes', { n: r.decoupling.minutes }),
      `${decouplingLabel(r)} ${decouplingText(r.decoupling, r.sport)}`, vt1Text(r)];
    for (const v of cells) {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    }
    return tr;
  }));
}

/** Startup: sign in, the manual profile, the account buttons and the tests. */
export function initProfile() {
  document.addEventListener('bw-language', renderProfile);
  sessionEvents.on('test', renderTests);
  sessionEvents.on('run', renderRuns);
  $('pKeySave').onclick = async () => {
    const key = $('pKey').value.trim();
    if (!key) return;
    intervals.setApiKey(key);
    renderKeyState(t('profile.checking'));
    try {
      const a = await intervals.getAthlete();
      $('pKey').value = '';
      renderKeyState();
      setAthlete(a);
      refreshWellness().catch((err) => log('warn', `Intervals.icu wellness: ${err.message}`));
      log('info', `Intervals.icu: signed in as ${a.name}`);
      loadWorkouts();
      loadProfileFromIntervals(); // the account wins: replaces the profile, even a manual one
    } catch (err) {
      intervals.setApiKey(''); // a key that does not work does not sign in
      renderKeyState(t('profile.signInFailed', { error: err.message }));
    }
  };
  $('pSave').onclick = saveManualProfile;
  document.addEventListener('bw-refresh', refreshAll);
  document.addEventListener('bw-signout', signOut);
  $('pTestApply').onclick = () => {
    const last = lastWithVt2(loadTests(), 'run');
    if (!last) return;
    const base = app.state.profile || { pacePct: DEFAULT_PACE_PCT, hrPct: DEFAULT_HR_PCT };
    setProfile({ ...base, thresholdKmh: last.vt2.kmh, lthr: last.vt2.hr, source: 'manual' });
    log('info', `Profile from the threshold test: LTHR ${last.vt2.hr}, threshold ${formatPace(last.vt2.kmh)}/km`);
  };
  // Only here: Intervals.icu keeps its cycling settings, and Refresh brings them back
  $('pTestApplyRide').onclick = () => {
    const last = lastWithVt2(loadTests(), 'ride');
    if (!last) return;
    const base = app.state.profile || { pacePct: DEFAULT_PACE_PCT, hrPct: DEFAULT_HR_PCT };
    setProfile({ ...base, ride: rideWithVt2(base.ride, last.vt2) });
    log('info', `Cycling profile from the bike test: LTHR ${last.vt2.hr}, indoor FTP ${last.vt2.w} W`);
  };
}

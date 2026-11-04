/**
 * The cards that warn when the HR zones disagree with VT1 (#41), on Home and
 * in Profile: one per sport, with a link to the Intervals.icu settings, and
 * dismissed until the value changes. It only warns: HR control does not change.
 */
import { $ } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import { zoneMismatch, isDismissed, dismissal } from '../session/zone-check.js';
import { loadRuns } from '../session/run-history.js';
import { loadTests } from '../session/test-history.js';
import { events as sessionEvents } from '../session/runner.js';
import * as app from '../state.js';
import { t } from '../i18n/index.js';

const SETTINGS_URL = 'https://intervals.icu/settings';
const HOSTS = ['hZoneCheck', 'pZoneCheck'];

function current() {
  const runs = loadRuns();
  const tests = loadTests();
  const zones = app.state.zones;
  return [
    zoneMismatch({ runs, tests, sport: 'run', hrZones: zones?.hr }),
    zoneMismatch({ runs, tests, sport: 'ride', hrZones: zones?.ride?.hr }),
  ].filter(Boolean).filter((m) => !isDismissed(m, settings.get('zoneCheck')));
}

function card(m) {
  const section = document.createElement('section');
  section.className = 'banner zone-check';
  const text = document.createElement('p');
  text.textContent = t(m.sport === 'ride' ? 'zoneCheck.ride' : 'zoneCheck.run', { vt1: m.vt1, z2: m.z2Start }) + ' ' + t(m.source === 'test' ? 'zoneCheck.fromTest' : 'zoneCheck.fromTrend');
  const actions = document.createElement('div');
  actions.className = 'row mt-8';
  const link = Object.assign(document.createElement('a'), { href: SETTINGS_URL, target: '_blank', rel: 'noopener', textContent: t('zoneCheck.settings') });
  const close = Object.assign(document.createElement('button'), { textContent: t('zoneCheck.dismiss') });
  close.onclick = () => {
    settings.set('zoneCheck', dismissal(m, settings.get('zoneCheck')));
    renderZoneCheck();
  };
  actions.append(link, close);
  section.append(text, actions);
  return section;
}

export function renderZoneCheck() {
  const found = current();
  for (const id of HOSTS) $(id).replaceChildren(...found.map(card));
}

/** Startup: drawn again when the zones or the histories change. */
export function initZoneCheck() {
  app.on('profile', renderZoneCheck);
  sessionEvents.on('run', renderZoneCheck);
  sessionEvents.on('test', renderZoneCheck);
  document.addEventListener('bw-language', renderZoneCheck);
  renderZoneCheck();
}

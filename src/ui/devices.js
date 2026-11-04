/**
 * Header pills for the devices: a treadmill (Run tab) and a smart trainer
 * (Ride tab), each with a menu built from the driver registry
 * (device-menu.js), and the heart rate strap. Their readings go to
 * session/live.js. No model is named here: drivers come from the registry.
 */

import { $, setPill } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import { getDriver, requestOptions, detect } from '../devices/registry.js';
import { live, addRr } from '../session/live.js';
import { deviceBack, needsDevice, announceLink } from '../session/runner.js';
import { createReconnector } from '../devices/reconnect.js';
import { log, renderInfo } from './debug.js';
import { updateControls } from './run.js';
import { updateTrainerCard } from './ride.js';
import { DEBUG } from './tabs.js';
import { connectPlan, menuEntries, KIND_NAMES } from './device-menu.js';
import * as app from '../state.js';
import { t } from '../i18n/index.js';

const PILLS = { treadmill: 'pillTreadmill', trainer: 'pillTrainer' };
const MENUS = { treadmill: 'menuTreadmill', trainer: 'menuTrainer' };
const LABELS = { treadmill: 'devices.pillTreadmill', trainer: 'devices.pillTrainer' };

// HR from the console or the trainer, only while no strap is connected to the page
function deviceHr(state, source) {
  if (hrStrap.bpm != null) return;
  if (state.rr?.length) addRr(state.rr, null); // only the simulators send RR this way
  live.hr = state.hr ?? null;
  live.hrSource = state.hr ? source : null;
}

// Last status of each pill, to write it again in another language
const pillStatus = {};

/** "Treadmill: connecting…" etc. in the interface language. */
function showStatus(kind, status, detail) {
  pillStatus[kind] = { status, detail };
  const label = t(LABELS[kind]);
  const map = {
    connecting: ['busy', t('devices.pillStatus', { device: label, state: t('devices.connecting') })],
    reconnecting: ['busy', t('devices.pillStatus', { device: label, state: t('devices.reconnecting') })],
    initializing: ['busy', t('devices.pillStatus', { device: label, state: t('devices.activating') })],
    ready: ['ready', t('devices.pillStatus', { device: label, state: detail || t('devices.ready') })],
    disconnected: ['error', t('devices.pillStatus', { device: label, state: t('devices.disconnected') })],
    error: ['error', t('devices.pillStatus', { device: label, state: t('devices.error') })],
  };
  const [s, text] = map[status] || ['error', t('devices.pillStatus', { device: label, state: status })];
  setPill(PILLS[kind], s, text);
  return text;
}

function refreshScreens() {
  updateControls();
  updateTrainerCard();
}

/**
 * Tries again after a drop during a session (#37), with the same Bluetooth
 * device: no chooser. pill(status) shows the state on the device's pill.
 */
function reconnector(kind, attempt, pill) {
  return createReconnector({
    attempt,
    shouldRetry: () => needsDevice(kind),
    onState: (state, d) => {
      if (state === 'retrying') {
        if (!live.link[kind]) {
          announceLink('reconnecting');
          live.link[kind] = 'reconnecting';
          pill('reconnecting');
        }
        log('warn', `${kind}: reconnecting, attempt ${d.attempt} in ${d.delay} s`);
      } else if (state === 'attempt') {
        log('info', `${kind}: reconnection attempt ${d.attempt}`);
      } else if (state === 'failed') {
        log('warn', `${kind}: attempt ${d.attempt} failed: ${d.error.message}`);
      } else if (state === 'back') {
        delete live.link[kind];
        log('info', `${kind}: reconnected`);
        announceLink('back');
        deviceBack(kind);
      } else if (state === 'stuck') {
        live.link[kind] = 'stuck';
        announceLink('stuck');
        pill('disconnected');
        log('warn', `${kind}: not back yet, still trying; connecting it by hand may be needed`);
      } else {
        delete live.link[kind];
        pill('disconnected');
      }
      refreshScreens();
    },
  });
}

// The reconnector of the connected device of each kind, and whether a disconnect was asked for
const retries = {};
const asked = {};

function callbacks(kind) {
  return {
    onStatus: (status, detail) => {
      // While it retries the pill stays on "reconnecting…": each attempt is in the log
      if (retries[kind]?.active && status !== 'ready') return;
      const text = showStatus(kind, status, detail);
      log(status === 'disconnected' ? 'warn' : 'info', text);
      const dev = app.state.devices[kind];
      if (status === 'ready' && !dev?.descriptor?.debugOnly) {
        // Remembered for the menu ("last: …"); simulators are not
        const last = settings.get('lastDevice');
        settings.set('lastDevice', { ...last, [kind]: { driver: dev?.descriptor?.id, name: detail || dev?.descriptor?.name } });
      }
      if (status === 'disconnected') {
        if (kind === 'treadmill') { live.speed = 0; live.console = {}; }
        else live.trainer = null;
        if (live.hrSource === (kind === 'treadmill' ? 'console' : 'trainer')) { live.hr = null; live.hrSource = null; }
        if (!asked[kind]) retries[kind]?.start();
        asked[kind] = false;
      }
      refreshScreens();
    },
    onData: kind === 'treadmill'
      ? (state) => {
        live.speed = state.speed ?? 0;
        live.incline = state.incline ?? 0;
        live.console = state;
        deviceHr(state, 'console');
      }
      : (state) => {
        live.trainer = state;
        deviceHr(state, 'trainer');
        updateTrainerCard();
      },
    onInfo: (info) => {
      live.info = info;
      renderInfo();
    },
    onLog: log,
    onControlLost: () => log('warn', `${kind}: another app took control`),
  };
}

/** Connects a device of a kind: a simulator by id, or the real one(s) from the registry. */
async function connect(kind, driverId = null) {
  retries[kind]?.stop();
  delete live.link[kind];
  showStatus(kind, 'connecting');
  try {
    let driver = driverId ? getDriver(driverId) : null;
    let device;
    if (!driver) {
      const plan = connectPlan(kind);
      if (plan.mode === 'single') driver = plan.driver;
      else if (plan.mode === 'chooser') {
        // One Bluetooth chooser for every driver of the kind, then the one that fits
        device = await navigator.bluetooth.requestDevice(requestOptions(kind));
        driver = detect(kind, device);
        if (!driver) throw new Error(`${device.name || 'This device'} is not a supported ${t(KIND_NAMES[kind])}`);
      } else throw new Error(t('devices.noSupport', { kind: t(KIND_NAMES[kind]) }));
    }
    const dev = driver.create(callbacks(kind));
    app.setDevice(kind, dev);
    retries[kind] = reconnector(kind, () => dev.connect(dev.device ? { device: dev.device } : undefined), (status) => showStatus(kind, status));
    await dev.connect(device ? { device } : undefined);
  } catch (err) {
    log('error', err.message);
    showStatus(kind, 'error');
  }
}

/** Connects the real device of a kind, from a click (a recovered session, #36). */
export const connectDevice = (kind) => connect(kind);

let hrName = null;
const hrStrap = getDriver('hr-strap').create({
  onHr: (bpm) => { live.hr = bpm; live.hrSource = 'strap'; },
  onRr: addRr,
  onStatus: (state, name) => {
    if (state === 'ready') { hrName = name; log('info', `hr: ${name || 'strap'} connected`); setPill('pillHr', 'ready', t('devices.pillStatus', { device: 'HRM', state: name || t('devices.connected') })); }
    else {
      live.hr = null;
      live.hrSource = null;
      setPill('pillHr', 'error', t('devices.pillStatus', { device: 'HRM', state: t('devices.disconnected') }));
      if (!hrRetry.active) hrRetry.start();
    }
  },
});
const hrRetry = reconnector('hr', () => hrStrap.connect({ device: hrStrap.device }), (status) => {
  if (status === 'reconnecting') setPill('pillHr', 'busy', t('devices.pillStatus', { device: 'HRM', state: t('devices.reconnecting') }));
  else setPill('pillHr', 'error', t('devices.pillStatus', { device: 'HRM', state: t('devices.disconnected') }));
});

/** Connects the strap from a click, with the chooser. If that fails during a session, the retries go on. */
async function connectStrap() {
  hrRetry.stop();
  try {
    setPill('pillHr', 'busy', t('devices.pillStatus', { device: 'HRM', state: t('devices.connecting') }));
    await hrStrap.connect();
  } catch (err) {
    log('error', t('devices.pillStatus', { device: 'HRM', state: err.message }));
    setPill('pillHr', 'error', t('devices.pillStatus', { device: 'HRM', state: t('devices.error') }));
    hrRetry.start();
  }
  refreshScreens();
}

/** Draws a kind's menu from the registry and the connected device. */
function renderMenu(kind) {
  const menu = $(MENUS[kind]);
  const device = app.state.devices[kind];
  const entries = menuEntries(kind, { debug: DEBUG, device, last: settings.get('lastDevice')[kind] });
  menu.replaceChildren(...entries.map((e) => {
    const b = document.createElement('button');
    b.textContent = e.label;
    b.disabled = !!e.disabled;
    if (e.primary) b.className = 'primary';
    if (e.danger) b.className = 'danger';
    b.dataset.action = e.action;
    b.onclick = () => {
      menu.hidePopover();
      if (e.action === 'connect') connect(kind);
      else if (e.action === 'simulator') connect(kind, e.driver);
      else if (e.action === 'sim-belt') device?.simulate({ belt: 'toggle' });
      else if (e.action === 'sim-pedal') device?.simulate({ pedaling: !device.pedaling });
      else if (e.action === 'sim-drop') device?.simulate({ drop: true });
      else if (e.action === 'disconnect') {
        asked[kind] = true;
        retries[kind]?.stop();
        device?.disconnect();
      }
    };
    return b;
  }));
}

/** Startup: the device menus and the HRM pill. */
export function initDevices() {
  app.setDevice('hr', hrStrap);
  // Pills not connected yet show their name in the interface language
  const idlePills = () => {
    for (const kind of Object.keys(PILLS)) {
      if (pillStatus[kind]) showStatus(kind, pillStatus[kind].status, pillStatus[kind].detail);
      else $(PILLS[kind]).textContent = t(LABELS[kind]);
    }
    const hr = $('pillHr').dataset.state;
    $('pillHr').textContent = hr === 'ready' ? t('devices.pillStatus', { device: 'HRM', state: hrName || t('devices.connected') }) : hr ? t('devices.pillStatus', { device: 'HRM', state: t(hr === 'busy' ? 'devices.connecting' : 'devices.disconnected') }) : 'HRM';
  };
  idlePills();
  document.addEventListener('bw-language', idlePills);
  for (const kind of Object.keys(MENUS)) {
    const menu = $(MENUS[kind]);
    // Opens under its pill, freshly drawn
    menu.addEventListener('toggle', (e) => {
      if (e.newState !== 'open') return;
      renderMenu(kind);
      const r = $(PILLS[kind]).getBoundingClientRect();
      menu.style.top = `${r.bottom + 6}px`;
      menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    });
  }
  document.addEventListener('bw-reconnect-strap', connectStrap);
  // While it retries the strap can be connected by hand: the chooser finds what a retry cannot
  $('pillHr').onclick = () => {
    const state = $('pillHr').dataset.state;
    if (state === 'ready' || (state === 'busy' && !hrRetry.active)) return;
    connectStrap();
  };
}

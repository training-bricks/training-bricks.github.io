/**
 * Run tab: the treadmill session. The chart and the shared half of the
 * dashboard (distance, time, HR, α1, session buttons, export and upload) come
 * from session-screen.js; this page adds pace and incline with their + and −
 * buttons, the treadmill's notes and the safety on closing the page.
 */

import { $ } from '../lib/dom.js';
import { formatPace } from '../workouts/steps.js';
import { live } from '../session/live.js';
import { session, events as sessionEvents, isActive, currentStep, pushTarget, pauseOnClose } from '../session/runner.js';
import { wakeError, requestWakeLock, releaseWakeLock, initWakeLock } from '../session/wake-lock.js';
import { beep } from '../lib/sound.js';
import { highlightSteps } from './workout.js';
import { log, renderConsole } from './debug.js';
import { ownSession, selectedSport, updateSessionChart, renderCommon, updateSessionButtons, wireSessionButtons } from './session-screen.js';
import * as app from '../state.js';
import { t } from '../i18n/index.js';

const bar = () => $('runBar').el;

export function updateChart() {
  updateSessionChart($('chart'), 'run', t('run.freeSession'));
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export function updateControls() {
  const dev = app.state.devices.treadmill;
  const connected = !!dev?.connected;
  const caps = dev?.capabilities ?? {};
  const active = ['armed', 'running', 'paused'].includes(session.state);
  // Bike workouts run on the Ride page
  const ride = selectedSport() === 'ride';
  updateSessionButtons(bar(), 'run', { canStart: connected && !ride, finishLabel: t('run.finish') });
  $('wPosition').disabled = $('wIncline').disabled = $('wHrAdjust').disabled = active;
  for (const list of document.querySelectorAll('bw-workout-list')) list.disabled = active;
  document.querySelectorAll('[data-speed],[data-incline]').forEach((b) => { b.disabled = !connected; });
  // Controls the connected treadmill has (incline buttons only if it can tilt)
  $('mInclineCtl').classList.toggle('hidden', connected && caps.incline === false);

  const own = ownSession('run');
  const state = own || session.state === 'idle' ? session.state : 'idle';
  const notes = {
    idle: connected ? t('run.note.pick') : t('run.note.connect'),
    armed: caps.remoteStart ? t('run.note.armedRemote') : t('run.note.armed'),
    running: session.steps.length ? t('run.note.running') : t('run.note.runningFree'),
    paused: t('run.note.paused'),
  };
  if (notes[state]) $('sessionNote').textContent = notes[state];
  if (wakeError && own && active) {
    $('sessionNote').textContent += ` ${wakeError}`;
  }
  if (state === 'idle' && app.state.selection?.needsProfile && !ride) {
    $('sessionNote').textContent = t('run.note.noThreshold');
  }
  if (state === 'idle' && ride) {
    $('sessionNote').textContent = t('run.note.bikeWorkout');
  }
  if (connected && live.console.alerts?.includes('safety-key-missing')) {
    $('sessionNote').textContent = t('run.note.safetyKey');
  }
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------
export function render() {
  const own = ownSession('run');
  $('mPace').textContent = formatPace(live.speed);
  const offTarget = own && session.target != null && session.state === 'running' && Math.abs(live.speed - session.target) > 0.15;
  $('mPace').classList.toggle('off-target', offTarget);
  $('mSpeedSub').textContent = `${live.speed.toFixed(1)} km/h` +
    (own && session.target != null ? ` · ${t('run.target', { value: formatPace(session.target) })}` : '');
  $('mIncline').textContent = live.incline.toFixed(1);
  const planned = own && ['running', 'paused'].includes(session.state) ? currentStep()?.incline : null;
  $('mInclineSub').textContent = planned != null ? t('run.target', { value: `${planned} %` }) : ' ';
  renderCommon(bar(), 'run');
  renderConsole();
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
function uploadMeta() {
  const dev = app.state.devices.treadmill;
  return {
    name: session.event ? `${session.event.name} (treadmill)` : 'Treadmill run',
    description: `${dev?.info?.name || dev?.descriptor?.name || 'Treadmill'} controlled by Brickwise. Base incline ${$('wIncline').value}%. Pace ${$('wPosition').selectedOptions[0].text.toLowerCase()} within the zone.`,
    device_name: dev?.descriptor?.name ?? 'Treadmill',
  };
}

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
/** Startup: the session buttons, the speed and incline buttons, and export. */
export function initRun() {
  // What the session reports
  let lastChart = 0;
  sessionEvents.on('change', () => {
    updateControls();
    updateChart();
    highlightSteps();
  });
  sessionEvents.on('tick', (now) => {
    render();
    if (session.state === 'running' && ownSession('run') && now - lastChart >= 1000) {
      lastChart = now;
      updateChart();
    }
  });
  sessionEvents.on('note', ({ text, append }) => {
    if (session.policy?.sport !== 'run') return;
    if (append) $('sessionNote').textContent += text;
    else $('sessionNote').textContent = text;
  });
  sessionEvents.on('beep', ({ freq, seconds }) => beep(freq, seconds));
  document.addEventListener('bw-language', () => { updateControls(); render(); updateChart(); });
  sessionEvents.on('active', (on) => (on ? requestWakeLock() : releaseWakeLock()));
  initWakeLock({ onChange: updateControls, log });
  // Closing or reloading the page during a workout pauses the belt (see session/runner.js)
  window.addEventListener('beforeunload', (e) => {
    if (!isActive()) return;
    pauseOnClose();
    e.preventDefault();
  });
  window.addEventListener('pagehide', pauseOnClose);

  app.on('selection', () => {
    render();
    updateChart();
    updateControls();
  });
  $('tab-run').querySelectorAll('[data-speed]').forEach((btn) => {
    btn.onclick = () => {
      const delta = parseFloat(btn.dataset.speed);
      if (ownSession('run') && currentStep()?.hasTarget && session.state === 'running') {
        session.adjust = Math.round((session.adjust + delta) * 10) / 10;
        pushTarget();
      } else {
        // Base: the requested speed the console reports (includes changes made on it)
        const reported = live.console.targetSpeed;
        const base = reported > 0 ? reported : session.target ?? live.speed;
        const dev = app.state.devices.treadmill;
        if (!dev) return;
        session.target = dev.clampSpeed(base + delta);
        dev.setTarget({ speed: session.target });
      }
    };
  });

  $('tab-run').querySelectorAll('[data-incline]').forEach((btn) => {
    btn.onclick = () => app.state.devices.treadmill?.setTarget({ incline: live.incline + parseFloat(btn.dataset.incline) });
  });

  wireSessionButtons(bar(), { sport: 'run', endNote: 'run.note.ended', upload: uploadMeta, note: $('sessionNote') });
}

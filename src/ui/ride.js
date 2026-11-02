/**
 * Ride tab: the smart trainer session, with the Run page's shape. The chart
 * and the shared half of the dashboard (distance, time, HR, α1, session
 * buttons, export and upload) come from session-screen.js; this page adds
 * power (ERG target ± 5 W), cadence and speed, resistance by hand on a free
 * ride, and the trainer's notes.
 */

import { $ } from '../lib/dom.js';
import { live } from '../session/live.js';
import { session, events as sessionEvents, currentStep, pushPower } from '../session/runner.js';
import { ownSession, selectedSport, updateSessionChart, renderCommon, updateSessionButtons, wireSessionButtons } from './session-screen.js';
import * as app from '../state.js';
import { t } from '../i18n/index.js';

const bar = () => $('rideBar').el;
const OFF_TARGET_W = 10;   // actual power this far from the target shows in the warning color

export function updateRide() {
  updateSessionChart($('rideChart'), 'ride', t('ride.freeRide'));
  updateRideControls();
  renderRide();
}

/** The target the trainer is asked for: the session's, or the manual ERG one. */
function targetWatts() {
  if (ownSession('ride') && session.targetPower != null && session.state !== 'done') return session.targetPower;
  const dev = app.state.devices.trainer;
  return dev?.mode === 'erg' ? dev.requested.power : null;
}

export function renderRide() {
  const s = live.trainer || {};
  const dev = app.state.devices.trainer;
  const target = targetWatts();
  $('rtPower').textContent = s.power != null ? Math.round(s.power) : '--';
  $('rtPower').classList.toggle('off-target', ownSession('ride') && session.state === 'running' && target != null && Math.abs((s.power ?? 0) - target) > OFF_TARGET_W);
  $('rtPowerSub').textContent = target != null ? `${t('run.target', { value: `${target} W` })} · ${t('ride.erg')}` : ' ';
  $('rtCadence').textContent = s.cadence != null ? Math.round(s.cadence) : '--';
  // With the resistance buttons showing, the line under cadence names what they change
  const level = dev?.mode === 'resistance' && dev.requested.resistance != null ? `${dev.requested.resistance} %` : '--';
  $('rtSpeedSub').textContent = !$('rtResistance').classList.contains('hidden') ? `${t('ride.resistance')} ${level}`
    : s.speed != null ? `${s.speed.toFixed(1)} km/h` : ' ';
  renderCommon(bar(), 'ride');
}

export function updateRideControls() {
  const dev = app.state.devices.trainer;
  const connected = !!dev?.connected;
  const caps = dev?.capabilities ?? {};
  const own = ownSession('ride');
  const active = ['armed', 'running', 'paused'].includes(session.state);
  const run = selectedSport() === 'run';
  updateSessionButtons(bar(), 'ride', { canStart: connected && !run, finishLabel: t('ride.finish') });
  $('tab-ride').querySelectorAll('[data-power]').forEach((b) => { b.disabled = !connected || caps.erg === false; });
  // Resistance by hand only outside a workout (a workout drives the trainer in ERG)
  $('rtResistance').classList.toggle('hidden', !connected || !caps.resistance || (own && active && session.steps.length > 0));

  const state = own || session.state === 'idle' ? session.state : 'idle';
  const notes = {
    idle: connected ? t('ride.note.pick') : t('ride.note.connect'),
    armed: t('ride.note.armed'),
    running: session.steps.length ? t('ride.note.running') : t('ride.note.runningFree'),
    paused: t('ride.note.paused'),
  };
  if (notes[state]) $('rideNote').textContent = notes[state];
  if (state === 'idle' && run) $('rideNote').textContent = t('ride.note.runWorkout');
  if (state === 'idle' && !run && app.state.selection?.needsProfile) $('rideNote').textContent += ` ${t('ride.noFtp')}`;
}

/** Kept for the device pills (devices.js): a trainer connected, lost or reporting. */
export function updateTrainerCard() {
  updateRideControls();
  renderRide();
}

function uploadMeta() {
  const dev = app.state.devices.trainer;
  const how = session.hrOn ? 'ERG with the watts steered by HR' : 'ERG';
  return {
    name: session.event ? `${session.event.name} (trainer)` : 'Trainer ride',
    description: `${dev?.info?.name || dev?.descriptor?.name || 'Smart trainer'} controlled by Brickwise (${how}).`,
    device_name: dev?.descriptor?.name ?? 'Smart trainer',
  };
}

/** Startup: the session events, power and resistance by hand, the session buttons. */
export function initRide() {
  let lastChart = 0;
  app.on('selection', updateRide);
  sessionEvents.on('change', updateRide);
  sessionEvents.on('tick', (now) => {
    renderRide();
    if (session.state === 'running' && ownSession('ride') && now - lastChart >= 1000) {
      lastChart = now;
      updateSessionChart($('rideChart'), 'ride', t('ride.freeRide'));
    }
  });
  sessionEvents.on('note', ({ text, append }) => {
    if (session.policy?.sport !== 'ride') return;
    if (append) $('rideNote').textContent += text;
    else $('rideNote').textContent = text;
  });
  document.addEventListener('bw-language', updateRide);

  $('tab-ride').querySelectorAll('[data-power]').forEach((btn) => {
    btn.onclick = () => {
      const delta = parseFloat(btn.dataset.power);
      const dev = app.state.devices.trainer;
      if (!dev?.connected) return;
      if (ownSession('ride') && currentStep()?.power && session.state === 'running') {
        // During a workout: like ± km/h on a run, it shifts the step's watts
        session.adjust += delta;
        pushPower();
      } else {
        // Not pedaling yet (0 W): start from 100 W, not from 0
        const base = targetWatts() ?? (live.trainer?.power > 0 ? Math.round(live.trainer.power) : 100);
        dev.setTarget({ power: base + delta });
      }
      renderRide();
    };
  });
  $('tab-ride').querySelectorAll('[data-resistance]').forEach((btn) => {
    btn.onclick = () => {
      const dev = app.state.devices.trainer;
      if (!dev?.connected) return;
      const base = dev.mode === 'resistance' && dev.requested.resistance != null ? dev.requested.resistance : 20;
      dev.setResistance(base + parseFloat(btn.dataset.resistance));
      renderRide();
    };
  });

  wireSessionButtons(bar(), { sport: 'ride', endNote: 'ride.note.ended', upload: uploadMeta, note: $('rideNote') });
}

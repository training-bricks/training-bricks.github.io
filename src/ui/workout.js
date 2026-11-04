/**
 * Workout page (no nav button: opened from a workout in Home or the
 * library): name, description, options, the steps table, totals and the
 * chart preview. It redraws on every new selection.
 */

import { $, escapeHtml } from '../lib/dom.js';
import * as app from '../state.js';
import { formatPace, formatDuration } from '../workouts/steps.js';
import { session } from '../session/runner.js';
import { planTimeline } from './session-screen.js';
import { t } from '../i18n/index.js';

const STEP_HEADS = {
  run: ['#', 'workout.step', 'workout.dur', 'km/h', 'workout.pace', '%'],
  ride: ['#', 'workout.step', 'workout.dur', 'W', 'common.hr'],
};

function renderStepHead(sport) {
  const tr = document.createElement('tr');
  STEP_HEADS[sport].forEach((text, i) => {
    const th = document.createElement('th');
    th.textContent = text.includes('.') ? t(text) : text;
    if (i > 1) th.className = 'r';
    tr.appendChild(th);
  });
  $('wStepsHead').replaceChildren(tr);
}

function renderWorkout() {
  const sel = app.state.selection;
  const body = $('wSteps');
  const ride = sel?.event.sport === 'ride';
  $('wHrAdjustRow').hidden = $('wAlphaRow').hidden = !sel?.hrControl;
  $('wAlphaGuard').disabled = !$('wHrAdjust').checked;
  // On a bike HR moves the watts instead of the speed
  const adjust = $('wHrAdjustRow').querySelector('[data-i18n]');
  adjust.dataset.i18n = ride ? 'workout.hrAdjustRide' : 'workout.hrAdjust';
  adjust.textContent = t(adjust.dataset.i18n);
  $('wHrAdjustRow').dataset.i18nTitle = ride ? 'workout.hrAdjustRideHelp' : 'workout.hrAdjustHelp';
  $('wHrAdjustRow').title = t($('wHrAdjustRow').dataset.i18nTitle);
  $('wPosition').closest('label').hidden = $('wIncline').closest('label').hidden = ride;
  renderStepHead(ride ? 'ride' : 'run');
  if (!sel) {
    body.innerHTML = '';
    $('wName').textContent = $('wName').title = t('workout.none');
    $('wDesc').textContent = t('workout.noneHelp');
    $('wTotal').textContent = '';
    return;
  }
  $('wName').textContent = $('wName').title = sel.event.name || t('common.workout'); // title: the full name when it is cut
  const missing = `${ride ? t('workout.noFtp') : t('workout.noThreshold')}\n`;
  $('wDesc').textContent = (sel.needsProfile ? missing : '') +
    (sel.event.description || '') +
    (sel.hrOn ? `\n♥ ${t(ride ? 'workout.hrOnRide' : 'workout.hrOn')}` : '');
  if (ride) {
    body.innerHTML = sel.steps.map((s, i) => {
      const dur = s.duration ? formatDuration(s.duration) : s.distance ? `${(s.distance / 1000).toFixed(2)} km` : '—';
      const w = s.power ? (s.power.lo === s.power.hi ? s.power.lo : `${s.power.lo}–${s.power.hi}`) : '—';
      const hr = s.hr ? (s.hr.lo > 0 ? `${s.hr.lo}–${s.hr.hi}` : `≤ ${s.hr.hi}`) : '—';
      return `<tr data-i="${i}"><td>${i + 1}</td><td>${escapeHtml(s.label)}</td><td class="r num">${dur}</td>` +
        `<td class="r num">${w}</td><td class="r num">${hr}</td></tr>`;
    }).join('');
    const sec = sel.steps.reduce((a, s) => a + (s.duration || 0), 0);
    $('wTotal').textContent = `${t('common.steps', { n: sel.steps.length })} · ~${formatDuration(sec)}`;
    highlightSteps();
    return;
  }
  body.innerHTML = sel.steps.map((s, i) => {
    const dur = s.duration ? formatDuration(s.duration) : s.distance ? `${(s.distance / 1000).toFixed(2)} km` : '—';
    const spd = s.hasTarget ? (s.ramp ? `${s.speedStart}→${s.speedEnd}` : s.speedStart.toFixed(1)) : t('common.free');
    const pace = s.hasTarget ? (s.ramp ? `${formatPace(s.speedStart)}→${formatPace(s.speedEnd)}` : formatPace(s.speedStart)) : '—';
    return `<tr data-i="${i}"><td>${i + 1}</td><td>${escapeHtml(s.label)}</td><td class="r num">${dur}</td>` +
      `<td class="r num">${spd}</td><td class="r num">${pace}</td><td class="r num">${s.incline}</td></tr>`;
  }).join('');

  const totalSec = sel.steps.reduce((a, s) => a + (s.duration || (s.distance && s.speedStart ? s.distance / (s.speedStart / 3.6) : 0)), 0);
  const totalKm = sel.steps.reduce((a, s) => a + (s.distance || (s.duration && s.speedStart ? s.duration * ((s.speedStart + s.speedEnd) / 2) / 3.6 : 0)), 0) / 1000;
  $('wTotal').textContent = `${t('common.steps', { n: sel.steps.length })} · ~${formatDuration(totalSec)} · ~${totalKm.toFixed(2)} km`;
  highlightSteps();
}

export function highlightSteps() {
  document.querySelectorAll('#wSteps tr').forEach((tr) => {
    const i = Number(tr.dataset.i);
    const active = session.state === 'running' || session.state === 'paused' || session.state === 'done';
    tr.classList.toggle('current', active && session.state !== 'done' && i === session.stepIdx);
    tr.classList.toggle('done', active && (i < session.stepIdx || session.state === 'done'));
  });
}

// The chosen workout's chart, on this page
export function updatePreview() {
  $('wPreview').update({ plan: planTimeline(true), samples: [], elapsed: 0, zones: app.zonesFor(app.state.selection?.event) });
}

const readOptions = () => ({
  position: $('wPosition').value,
  defaultIncline: parseFloat($('wIncline').value) || 0,
  hrAdjust: $('wHrAdjust').checked,
  alphaGuard: $('wAlphaGuard').checked,
});

/** Startup: the options (pace in the zone, base incline, HR adjust) and the redraw on each selection. */
export function initWorkoutPage() {
  app.setWorkoutOptions(readOptions());
  for (const id of ['wPosition', 'wIncline', 'wHrAdjust', 'wAlphaGuard']) $(id).onchange = () => app.setWorkoutOptions(readOptions());
  app.on('selection', () => {
    renderWorkout();
    updatePreview();
  });
}

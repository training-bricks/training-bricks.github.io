/**
 * What the Run and Ride pages share around a session: the plan on the
 * session's time line, the common half of the dashboard (<bw-session-bar>:
 * distance, time, HR, α1 and the session buttons), the export menu, CSV, FIT
 * and TCX downloads and the upload to Intervals.icu. Each page passes its sport;
 * the numbers and buttons of a session belong to the page of its sport.
 */
import { download } from '../lib/dom.js';
import { formatDuration } from '../workouts/steps.js';
import { hrZoneOf } from '../physiology/zones.js';
import { alphaState } from '../physiology/hrv.js';
import { buildTcx } from '../export/tcx.js';
import { buildFit } from '../export/fit.js';
import { samplesToCsv } from '../export/csv.js';
import * as intervals from '../services/intervals.js';
import * as settings from '../lib/settings.js';
import { uploadDescription } from '../session/summary.js';
import { RPE_VALUES, FEEL_VALUES, rpeLabel, feelLabel, feedbackFields, pickAnswer } from '../session/feedback.js';
import { live, rrState, rrActive, hrNow } from '../session/live.js';
import { session, events as sessionEvents, applyStep, start, endSession, cancel, setIntensity, currentStep, searching } from '../session/runner.js';
import { intensityFactor, INTENSITY_MIN, INTENSITY_MAX } from '../session/policies.js';
import { log } from './debug.js';
import * as app from '../state.js';
import { t } from '../i18n/index.js';

/** Estimated duration of a step (distance steps are converted with their target). */
function plannedSeconds(step) {
  if (step.duration) return step.duration;
  const kmh = step.hasTarget ? (step.speedStart + step.speedEnd) / 2 : 8;
  return step.distance ? step.distance / (kmh / 3.6) : 60;
}

/**
 * Plan blocks in session time. Steps already done use their actual start and
 * end (skips, pauses or distance steps); the rest are chained with their
 * planned duration.
 */
export function planTimeline(planOnly = false) {
  const active = !planOnly && session.state !== 'idle';
  const steps = active ? session.steps : app.state.selection?.steps || [];
  const out = [];
  let t = 0;
  steps.forEach((step, i) => {
    const started = active ? session.stepStarts[i] : undefined;
    const t0 = started ?? t;
    let t1 = session.stepStarts[i + 1];
    if (t1 == null || !active) {
      t1 = t0 + plannedSeconds(step);
      if (active && i === session.stepIdx && session.state !== 'done') {
        // Current step: what is left given its progress
        t1 = Math.max(session.totalElapsed, t0 + plannedSeconds(step));
      }
    }
    // At the workout intensity (#39): steps done keep the one they ended with
    const pct = active ? (i < session.stepIdx ? session.stepIntensity[i] : null) ?? session.intensity : 100;
    const f = intensityFactor(step, pct);
    const by = (v) => (v == null ? v : v * f);
    out.push({
      t0, t1, speedStart: by(step.speedStart), speedEnd: by(step.speedEnd), ramp: step.ramp, incline: step.incline,
      power: step.power && { lo: step.power.lo * f, hi: step.power.hi * f },
      zone: step.zone, hr: step.hr, intensity: step.intensity?.map(by) ?? step.intensity,
    });
    t = t1;
  });
  return out;
}

/** The sport of the selected workout, or null without one. */
export const selectedSport = () => (app.state.selection ? (app.state.selection.event?.sport === 'ride' ? 'ride' : 'run') : null);

/** Whether the session (running or finished) belongs to this page's sport. */
export const ownSession = (sport) => session.state !== 'idle' && session.policy?.sport === sport;

/** The note when this page's device is gone during its session (#36, #37), or ''. */
export function linkNote(kind) {
  if (!ownSession(kind === 'trainer' ? 'ride' : 'run') || !['running', 'paused'].includes(session.state)) return '';
  if (live.link[kind] === 'reconnecting') return t('session.reconnecting');
  if (!app.state.devices[kind]?.connected) return t('session.linkLost');
  return session.hrLostTold ? t(session.hrFellBack ? 'session.hrLostPlan' : 'session.hrLost') : '';
}

/** The chart of a page: the plan (or the session's) with its samples. */
export function updateSessionChart(chart, sport, fallbackName) {
  const own = ownSession(sport);
  const event = own ? session.event : app.state.selection?.event;
  chart.update({ plan: planTimeline(!own), samples: own ? session.samples : [], elapsed: own ? session.totalElapsed : 0, zones: app.zonesFor(event ?? { sport }) });
  chart.heading = event?.name || fallbackName;
}

/** Distance, time, HR (with its zone and source) and α1 of the session, in the bar. */
export function renderCommon(el, sport) {
  const own = ownSession(sport);
  el.dist.textContent = ((own ? session.totalDist : 0) / 1000).toFixed(2);
  el.time.textContent = formatDuration(own ? session.totalElapsed : 0);
  const zones = app.zonesFor(own ? session.event ?? { sport } : app.state.selection?.event ?? { sport });
  const hr = hrNow();
  const hz = hrZoneOf(zones, hr);
  el.hr.textContent = hr || '--';
  el.hrSub.textContent = `bpm${hz ? ` · Z${hz}` : ''}`;
  el.hrBox.title = live.hrSource === 'console' ? t('run.hrFromConsole') : live.hrSource === 'strap' ? t('run.hrFromStrap') : live.hrSource === 'trainer' ? t('run.hrFromTrainer') : t('run.heartRate');
  renderAlpha(el);
}

/** α1 in the bar, to the right of HR. */
function renderAlpha(el) {
  el.alphaBox.classList.toggle('hidden', !rrActive());
  if (!rrActive()) return;
  const a = rrState.alpha;
  const state = alphaState(a?.alpha1);
  el.alphaBox.dataset.state = state || 'none';
  el.alpha.textContent = a?.alpha1 != null ? a.alpha1.toFixed(2) : '--';
  el.alphaSub.textContent = a?.alpha1 != null ? `α1 · ${t(`alpha.${state}`)}`
    : rrState.contact === false ? `α1 · ${t('alpha.noContact')}`
      : a?.reason === 'noisy signal' ? `α1 · ${t('alpha.noisy', { pct: Math.round(a.artifactPct) })}`
        : `α1 · ${t('alpha.computing')}`;
  el.alphaBox.title = t('alpha.help') +
    (a ? ` · ${t('alpha.beats', { n: a.beats, pct: a.artifactPct.toFixed(1) })}` : '');
}

/**
 * The bar's buttons for this page. canStart: the page's device is connected
 * and the selected workout (if any) is of this sport. finishLabel: what ■
 * does on this device.
 */
export function updateSessionButtons(el, sport, { canStart, finishLabel }) {
  const active = ['armed', 'running', 'paused'].includes(session.state);
  const own = ownSession(sport);
  el.start.disabled = !canStart || active;
  const startLabel = app.state.selection ? t('run.startWorkout') : t('run.startFreeSession');
  el.start.title = startLabel;
  el.start.setAttribute('aria-label', startLabel);
  el.skip.disabled = !(own && session.steps.length && (session.state === 'running' || session.state === 'paused'));
  el.finish.disabled = !(own && active);
  el.reconnect.classList.toggle('hidden', !(own && active && live.link.hr === 'stuck'));
  el.finish.title = finishLabel;
  el.finish.setAttribute('aria-label', finishLabel);
  const finished = own && session.state === 'done' && session.samples.length > 0;
  el.export.disabled = !finished;
  el.upload.disabled = !(finished && session.samples.length > 10 && intervals.getApiKey() && !session.uploaded);
  el.upload.title = intervals.getApiKey() ? t('run.uploadWhenFinished') : t('run.uploadSignIn');
  el.upload.setAttribute('aria-label', t('run.upload'));
  // A step whose speed HR is finding has nothing planned to scale
  const scaling = own && active && session.steps.length > 0 && !searching(currentStep());
  el.intensityBox.classList.toggle('hidden', !scaling);
  el.intensity.textContent = `${session.intensity} %`;
  el.intensityDown.disabled = session.intensity <= INTENSITY_MIN;
  el.intensityUp.disabled = session.intensity >= INTENSITY_MAX;
  el.feedback.classList.toggle('hidden', !finished);
  if (finished) {
    el.rpe.value = session.rpe ?? '';
    el.feel.value = session.feel ?? '';
  }
}

/** The RPE and Feel lists, in the interface language. */
function fillFeedback(el) {
  const fill = (select, values, label) => {
    const current = select.value;
    select.replaceChildren(new Option(t('feedback.none'), ''), ...values.map((v) => new Option(label(v), v)));
    select.value = current;
  };
  fill(el.rpe, RPE_VALUES, rpeLabel);
  fill(el.feel, FEEL_VALUES, feelLabel);
}

/** Sends the answers to the uploaded activity; a failure only says so: the activity is there. */
async function sendFeedback(note) {
  const fields = feedbackFields(session);
  if (!fields || !session.activityId) return;
  try {
    await intervals.updateActivity(session.activityId, fields);
    log('info', `Intervals.icu activity ${session.activityId}: ${JSON.stringify(fields)}`);
  } catch (err) {
    note.textContent = t('feedback.failed', { error: err.message });
    log('error', `RPE and Feel: ${err.message}`);
  }
}

const fileStamp = () => new Date(session.startedAt).toISOString().slice(0, 16).replace(':', '');

/**
 * Wires the bar's buttons. opts.sport starts free sessions of this page's
 * sport; opts.endNote is the note when ■ ends a session; opts.upload() gives
 * { name, description, device_name } for the activity; opts.note is the
 * page's note line (upload progress).
 */
export function wireSessionButtons(el, { sport, endNote, upload, note }) {
  el.start.onclick = () => start({ sport });
  el.skip.onclick = () => {
    if (session.state === 'running' || session.state === 'paused') applyStep(session.stepIdx + 1);
  };
  el.finish.onclick = () => {
    if (session.state === 'armed') { cancel(); return; }
    endSession(t(endNote)); // a treadmill slows down to a walk first; a trainer is released
  };

  el.reconnect.onclick = () => document.dispatchEvent(new Event('bw-reconnect-strap')); // ui/devices.js

  el.intensityDown.onclick = () => setIntensity(session.intensity - 1);
  el.intensityUp.onclick = () => setIntensity(session.intensity + 1);

  // RPE and Feel: optional; after the upload an answer goes straight to the activity
  fillFeedback(el);
  document.addEventListener('bw-language', () => fillFeedback(el));
  el.rpe.onchange = () => { session.rpe = pickAnswer(el.rpe.value, RPE_VALUES); sendFeedback(note); };
  el.feel.onchange = () => { session.feel = pickAnswer(el.feel.value, FEEL_VALUES); sendFeedback(note); };

  // Export menu: under its button, inside the window
  el.menu.addEventListener('toggle', (e) => {
    if (e.newState !== 'open') return;
    const r = el.export.getBoundingClientRect();
    el.menu.style.top = `${r.bottom + 6}px`;
    el.menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - el.menu.offsetWidth - 8))}px`;
  });
  el.csv.onclick = () => {
    el.menu.hidePopover();
    if (!session.samples.length) return;
    download(`brickwise-${fileStamp()}.csv`, samplesToCsv(session.samples), 'text/csv');
  };
  const fitFile = (meta) => buildFit(session.samples, { sport, steps: session.steps, name: meta.name, deviceName: meta.device_name });
  el.fit.onclick = () => {
    el.menu.hidePopover();
    download(`brickwise-${fileStamp()}.fit`, fitFile(upload()), 'application/vnd.ant.fit');
  };
  el.tcx.onclick = () => {
    el.menu.hidePopover();
    const tcx = buildTcx(session.samples, { name: upload().name, sport });
    download(`brickwise-${fileStamp()}.tcx`, tcx, 'application/vnd.garmin.tcx+xml');
  };

  el.upload.onclick = async () => {
    el.upload.disabled = true;
    note.textContent = t('run.uploading');
    try {
      const meta = upload();
      const data = await intervals.uploadFit(fitFile(meta), {
        ...meta, description: uploadDescription(meta.description, session, { summary: settings.get('uploadSummary') }), external_id: `brickwise-${session.startedAt}`, paired_event_id: session.event?.id,
      });
      const id = data.id || data.activities?.[0]?.id;
      session.uploaded = true;
      session.activityId = id ?? null;
      sessionEvents.emit('uploaded');
      note.textContent = `${t('run.uploaded')} `;
      if (id) {
        const a = Object.assign(document.createElement('a'), {
          href: `https://intervals.icu/activities/${encodeURIComponent(id)}`, target: '_blank', rel: 'noopener', textContent: t('run.viewOnIntervals'),
        });
        note.appendChild(a);
      }
      log('info', `Activity uploaded to Intervals.icu ${id || ''}`);
      await sendFeedback(note);
    } catch (err) {
      note.textContent = t('run.uploadFailed', { error: err.message });
      log('error', `Upload: ${err.message}`);
      el.upload.disabled = false;
    }
  };
}

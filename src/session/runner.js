/**
 * Runs a session: waits for the belt, walks the workout steps, sends speed
 * and incline, records a sample per second, adjusts by HR and α1, and
 * analyzes the threshold test when it ends.
 *
 * No DOM and no UI imports: what happens is reported through `events`
 * ('change', 'tick', 'log', 'note', 'beep', 'cue', 'active', 'test', 'run'), and the
 * screens subscribe. tick(now) takes the clock as an argument for tests.
 */

import { createEmitter } from '../lib/events.js';
import { targetSpeedAt, searchesSpeed } from '../workouts/steps.js';
import { VT1, VT2 } from '../physiology/hrv.js';
import { analyzeRamp } from '../physiology/thresholds.js';
import { hrDecision, hrSlope, hrTrend, inclineStep, alphaVetoApplies, alphaDropApplies, SLOPE_WINDOW_S, AEROBIC_AIM, SPEED, POWER, roundTo } from './hr-control.js';
import { live, rrState, rrActive, updateAlpha, hrNow } from './live.js';
import { addTest, testText } from './test-history.js';
import { addRun, runText } from './run-history.js';
import { aerobicSummary } from '../physiology/aerobic.js';
import { policyFor, isStale, powerAt, intensityFactor, INTENSITY_MIN, INTENSITY_MAX, POLICIES } from './policies.js';
import * as app from '../state.js';
import { t } from '../i18n/index.js';

/**
 * What the session reports:
 * - 'change': state or step changed (armed, running, paused, done, cancelled, new step)
 * - 'tick': every tick (live numbers)
 * - 'log' { kind, text }, 'note' { text, append }: log line and session note
 * - 'beep' { freq, seconds, countdown? }: step changes and the last seconds of a step
 * - 'cue' { kind, … }: what the voice may say (session/voice-cues.js, #38)
 * - 'active' true | false: a session started, or ended / was cancelled (wake lock)
 * - 'test' { result }: a threshold test was analyzed and saved
 * - 'run' { summary }: a steady aerobic run's metrics were saved (#4)
 * - 'uploaded': the session is on Intervals.icu (session-screen.js says so)
 */
export const events = createEmitter();
const log = (kind, text) => events.emit('log', { kind, text });
const note = (text, append = false) => events.emit('note', { text, append });
const beep = (freq, seconds, countdown = false) => events.emit('beep', { freq, seconds, countdown });
const cue = (c) => events.emit('cue', c);
const changed = () => events.emit('change');

/** What the session counts for its summary (#35); unit: what HR moves. */
const emptyStats = () => ({ unit: 'km/h', hrRises: 0, hrDrops: 0, hrUp: 0, hrDown: 0, inclineMoves: 0, alphaGuards: 0, pauses: 0, pausedMs: 0, pausedSince: null, cooldownFrom: null });

const ACTIVE = ['armed', 'running', 'paused'];
// The session's sport decides the device it drives (session/policies.js)
const policy = () => session.policy ?? POLICIES.run;
/** What HR moves on this session's device: speed on a treadmill, watts on a trainer. */
const actuator = () => (policy().kind === 'trainer' ? POWER : SPEED);
/** The zones the session is planned against (the cycling ones on a bike). */
const zones = () => app.zonesFor(session.event ?? { sport: policy().sport });
const device = () => app.state.devices[policy().kind];
const limits = () => device()?.limits ?? {};
export const isActive = () => ACTIVE.includes(session.state);

const NEXT_CUE_S = 10;       // the next step is announced this long before it starts
const AUTO_PAUSE_MS = 2000;  // belt (or pedals) stopped this long → pause

// Ending a run: the belt never goes from running speed to 0 at once (a
// runner can stumble and fall). It slows down step by step to its lowest
// speed (a treadmill may reject 0, the EXP 5i does), holds it a moment, then
// pauses: from 3 km/h the pause was still a jump. STOP on the console or the
// safety key stop it at once.
const STOP_STEP_KMH = 0.5;   // km/h per step down…
const STOP_STEP_S = 2;       // …every this many seconds (8 km/h → 0.8 in 30 s)
const STOP_HOLD_S = 3;       // at the lowest speed this long, then the belt pauses

// Speed adjustment by HR (steps carry the HR range of their zones)
const CONSOLE_SETTLE_S = 3;  // a command takes this long to show on the console
const HR_GRACE_S = 45;       // at the start of a step HR takes a while to respond
const HR_LOST_TELL_S = 10;   // HR lost this long: the athlete is told
const HR_LOST_PLAN_S = 60;   // and this long: back to the plan
const HR_HOLD_S = 10;        // the same correction must be asked for this long in a row
const HR_SPACING_S = 25;     // between one adjustment and the next
const HR_RISE_SPACING_S = 60; // between two rises: HR answers a rise 1–2 min later (#10)
const SEARCH_RISE_SPACING_S = 30; // the same while searching for the speed, far under the aim
const SEARCH_MAX_KMH = 12;   // a search never goes above this: a strap reading low must not speed the belt up for ever
const ALPHA_HOLD_S = 60;     // median α1 of this many seconds below VT1 → the α1 guard is on
const ALPHA_RELEASE = 0.8;   // the guard turns off once the median α1 is above this…
const ALPHA_RELEASE_S = 60;  // …over this many seconds (hysteresis: VT1 alone flipped it back and forth, #10)
const ALPHA_DROP_SPACING_S = 90; // between α1 drops: the 2 min α1 window needs time to show a change (#10)
const ALPHA_MIN_S = 120;     // into the session before α1 is trusted (full 2 min window)
const WARMUP_HOLD_S = 5;     // HR at the top of Z1 this long ends a warm-up ramp
const INCLINE_SPACING_S = 40; // between incline adjustments (the motor is slow and noisy)
const TEST_STOP_ALPHA = 0.45; // the threshold test ends once α1 is this far past VT2…
const TEST_STOP_HOLD_S = 20;  // …for this long
const TEST_MIN_S = 180;       // and never before this much ramp

export const session = {
  state: 'idle', // idle | armed | running | paused | done
  steps: [],
  stepIdx: 0,
  stepElapsed: 0,
  stepDist: 0,
  totalElapsed: 0,
  totalDist: 0,
  adjust: 0,          // manual + / − in this step (km/h, or W on a trainer)
  hrAdjust: 0,        // what the HR adjustment removed (or added) in this step (km/h, or W)
  hrOutSince: null,   // since when (step s) the same correction has been asked for
  hrWantDir: 0,       // direction of that correction: -1, 0 or 1
  hrLastAdjust: null, // step s of the last HR adjustment
  hrLastRise: null,   // step s of the last HR adjustment that raised speed
  alphaGuard: false,  // α1 guard on: no rises on aerobic steps, and drops (see hr-control.js)
  alphaLastDrop: null, // session s of the last α1 drop
  reason: null,       // why speed last changed, for the next sample (CSV)
  warmupHrSince: null, // step s since HR has been at the top of Z1 in a warm-up ramp
  target: null,       // km/h the page is requesting right now
  stopSince: null,
  samples: [],
  nextSample: 0,      // session second of the next sample
  startedAt: null,
  event: null,
  lastBeep: null,
  stepStarts: [],     // session time (s) when each step started
  intensity: 100,     // workout intensity in % (#39): scales this and the next steps
  stepIntensity: [],  // the intensity each step ended with, for the chart
  stats: emptyStats(), // what happened, for the summary (session/summary.js)
  aerobic: null,      // aerobic metrics saved at the end (#4)
  testResult: null,   // threshold test result, or testError why it failed
  testError: null,
};

export function resetSession() {
  Object.assign(session, {
    state: 'idle', steps: [], stepIdx: 0, stepElapsed: 0, stepDist: 0, totalElapsed: 0, totalDist: 0,
    adjust: 0, hrAdjust: 0, speedSentAt: null, hrOutSince: null, hrWantDir: 0, hrOn: false, hrOnly: false, hrLastAdjust: null, hrLastRise: null, carried: {}, hrSeen: false, hrLostAt: null, hrLostTold: false, hrFellBack: false, hrBackAt: null, hrLostInStep: false, zoneEnded: {}, inclineAdjust: 0, testStart: null, testEnd: null, testLowSince: null, testMarks: {}, alphaGuard: false, alphaLastDrop: null, reason: null, warmupHrSince: null, target: null, stopSince: null, samples: [], nextSample: 0, startedAt: null, event: null, lastBeep: null,
    stepStarts: [], uploaded: false, policy: null, targetPower: null, rpe: null, feel: null, activityId: null, intensity: 100, stepIntensity: [], stats: emptyStats(), aerobic: null, testResult: null, testError: null,
  });
}

export function currentStep() {
  return session.steps[session.stepIdx] || null;
}

function stepProgress(step) {
  if (!step) return 0;
  if (step.duration) return session.stepElapsed / step.duration;
  if (step.distance) return session.stepDist / step.distance;
  return 0;
}

/** The steps that repeat: walks, and HR-target steps with the same range and plan. Null for any other. */
function repeatKey(s) {
  if (s?.walk) return 'walk';
  if (!s?.hr || s.hr.mode !== 'target' || s.hr.by === 'incline' || s.ramp || s.warmup || s.cooldown || s.test) return null;
  return [s.hr.lo, s.hr.hi, s.speedStart, s.power?.lo, s.power?.hi].join('|');
}

/** Changes made on the console since the last command, which the plan knows nothing about. */
function consoleOffset() {
  const reported = live.console.targetSpeed;
  const settled = session.speedSentAt == null || session.totalElapsed - session.speedSentAt >= CONSOLE_SETTLE_S;
  return policy().kind === 'treadmill' && reported > 0 && session.target != null && settled ? roundTo(reported - session.target, 1) : 0;
}

/** A console change becomes part of the step, so the next command starts from it (#60: 3.2 km/h on the console, then +0.2 by HR, asked 8.2). */
function absorbConsole() {
  if (session.state !== 'running' || !(live.speed > 0)) return; // a belt restarting reports its own low speed
  const off = consoleOffset();
  if (!off) return;
  session.adjust = roundTo(session.adjust + off, 1);
  session.target = roundTo(session.target + off, 1);
  log('info', `Speed changed on the console: now ${session.target} km/h`);
}

/** Where a repeating step ended: the next one like it starts there (2026-11-04: each rep went back to a speed known to be too low). */
function rememberStep() {
  const step = currentStep();
  const key = repeatKey(step);
  if ((!session.hrOn && !step.walk) || !key || session.stepStarts[session.stepIdx] == null || session.hrLostInStep) return;
  const off = consoleOffset();
  session.carried[key] = { hrAdjust: session.hrAdjust, adjust: roundTo(session.adjust + off, 1), speed: session.target == null ? null : roundTo(session.target + off, 1) };
}

/** Where a step starts if the last one like it is carried, or null. With the α1 guard on, a rise is not carried. */
function carriedFor(step) {
  const was = (session.hrOn || step.walk) && !session.hrFellBack && session.carried[repeatKey(step)];
  if (!was) return null;
  if (searching(step)) return was.speed == null ? null : { speed: was.speed };
  const veto = session.alphaGuard && alphaVetoApplies({ zone: step.zone, warmup: step.warmup, cooldown: step.cooldown });
  return { hrAdjust: veto ? Math.min(0, was.hrAdjust) : was.hrAdjust, adjust: was.adjust };
}

/** The next repetition starts where the last one ended, still under HR control. */
function carryInto(step) {
  const was = carriedFor(step);
  if (!was) return;
  if (was.speed != null) {
    session.target = was.speed;
    log('info', `Starts at ${was.speed} km/h, where the last one like it ended`);
    return;
  }
  session.hrAdjust = was.hrAdjust;
  session.adjust = was.adjust;
  const total = roundTo(session.hrAdjust + session.adjust, actuator().decimals);
  if (total) {
    session.reason = `from the last one like it: ${total > 0 ? '+' : ''}${total} ${actuator().unit}`;
    log('info', `Starts ${total > 0 ? '+' : ''}${total} ${actuator().unit} over the plan, where the last one like it ended`);
  }
}

export function applyStep(i) {
  if (policy().kind === 'treadmill' && !searching(currentStep())) absorbConsole();
  const before = policy().kind === 'trainer' ? session.targetPower : session.target; // where the previous step ended
  rememberStep();
  rememberZone(before);
  session.stepIdx = i;
  session.stepStarts[i] = session.totalElapsed;
  session.stepIntensity[i] = session.intensity;
  session.stepElapsed = 0;
  session.stepDist = 0;
  session.adjust = 0;
  session.hrAdjust = 0;
  session.inclineAdjust = 0;
  session.hrOutSince = null;
  session.hrWantDir = 0;
  session.hrLastAdjust = null;
  session.hrLastRise = null;
  session.hrLostInStep = session.hrLostAt != null;
  session.warmupHrSince = null;
  session.lastBeep = null;
  session.nextCued = false;
  const step = currentStep();
  if (step?.test) session.testStart ??= session.totalElapsed;
  else if (session.testStart != null) session.testEnd ??= session.totalElapsed;
  if (!step) {
    endSession(t(policy().words.done));
    return;
  }
  log('info', `Step ${i + 1}/${session.steps.length}: ${step.label}`);
  beep(i === 0 ? 660 : 880, 0.25);
  carryInto(step);
  startFrom(step, before);
  sendStep(true);
  changed();
}

/** Under HR control, the pace a step ended at is the one its end zone starts at next time. */
function rememberZone(before) {
  const step = currentStep();
  if (byHr(step) && !step.walk && step.zoneEnd != null && before != null) session.zoneEnded[step.zoneEnd] = before;
}

const byHr = (step) => session.hrOn && !session.hrFellBack && !!step?.hr && step.hr.mode !== 'info';

/**
 * A cool-down starts no faster than the step before it ended: after HR
 * brought the main step down to 7.1 km/h, a ramp from 7.6 sped the athlete
 * up (2026-10-30, #10). The ramp keeps its shape from there. Under HR
 * control, a step starts at the pace the last step that ended in its start
 * zone ended at, up or down, marked or not: the step just before for a ramp
 * down from Z2 after Z2 (2026-11-06: it went from 7.3 back up to 8), the last
 * rest for the next rest. With the α1 guard on, not up. A zone not run yet,
 * or no HR, starts from the plan.
 */
function startFrom(step, before) {
  const a = actuator();
  const planned = a === POWER ? powerAt(step, 0) : step.hasTarget ? targetSpeedAt(step, 0) : null;
  if (planned == null) return;
  const ended = byHr(step) && !step.walk ? session.zoneEnded[step.zoneStart] : undefined;
  const from = step.cooldown && before != null ? Math.min(before, ended ?? before) : ended;
  if (from == null) return;
  const base = roundTo(planned * intensityFactor(step, session.intensity), a.decimals);
  const up = from > base && !step.cooldown && !(session.alphaGuard && alphaVetoApplies(step));
  if (from === base || (from > base && !up)) return;
  // A new base, not an HR adjustment: HR keeps its whole range from here, and a cap gives nothing back
  session.hrAdjust = 0;
  session.adjust = roundTo(from - base, a.decimals);
  if (step.cooldown) session.stats.cooldownFrom = from;
  session.reason = `${step.cooldown ? 'cool-down' : `Z${step.zoneStart}`} from ${from} ${a.unit}`;
  log('info', `${step.cooldown ? 'Cool-down starts' : `Starts`} at ${from} ${a.unit}, not ${base}: ${step.cooldown ? 'the previous step ended there' : `the last step in Z${step.zoneStart} ended there`}`);
}

/** Sends the current step's targets: speed and incline on a treadmill, power on a trainer. */
function sendStep(force = false) {
  if (policy().kind === 'trainer') return pushPower(force);
  pushIncline();
  pushTarget(force);
}

/** Pauses the belt or releases the trainer. */
function stopDevice() {
  const d = device();
  if (policy().kind === 'trainer') d?.stop?.();
  else slowDownToStop(d);
}

/** Ends the session and stops the device (gently on a treadmill): the end of the workout and ■. */
export function endSession(message) {
  finish(message);
  stopDevice();
}

let slowdown = null; // { device, speed, next: ms } while the belt slows down to a stop

/** Starts slowing the belt down: incline to 0, then speed down to the lowest it takes (see STOP_*). */
function slowDownToStop(d) {
  if (!d) return;
  const from = Math.round(live.speed * 10) / 10;
  const lowest = d.limits?.speedMin ?? STOP_STEP_KMH;
  if (from <= lowest) { slowdown = null; d.pause(); return; }
  slowdown = { device: d, speed: from, lowest, next: 0 };
  d.setTarget({ incline: d.limits?.inclineMin ?? 0 });
  log('info', `Slowing down from ${from.toFixed(1)} km/h to ${lowest.toFixed(1)} km/h, then the belt pauses`);
}

/** One step of the slow-down, every tick until the belt pauses. */
function slowDownStep(now) {
  const s = slowdown;
  // Paused or stopped from the console, or the treadmill went away: nothing left to do
  if (!s.device.connected || !POLICIES.run.moving()) { slowdown = null; return; }
  if (now < s.next) return;
  if (s.speed > s.lowest) {
    s.speed = Math.max(s.lowest, Math.round((s.speed - STOP_STEP_KMH) * 10) / 10);
    s.device.setTarget({ speed: s.speed });
    s.next = now + (s.speed > s.lowest ? STOP_STEP_S : STOP_HOLD_S) * 1000;
    return;
  }
  slowdown = null;
  s.device.pause();
  log('info', 'Lowest speed reached: belt paused');
}

/** Sends the ride step's watts (ramps follow the progress) plus the manual and HR adjustments, when they change. */
export function pushPower(force = false) {
  const step = currentStep();
  const base = powerAt(step, stepProgress(step));
  if (base == null) return;
  const l = limits();
  const w = Math.round(Math.min(l.powerMax ?? Infinity, Math.max(l.powerMin ?? 0, base * intensityFactor(step, session.intensity) + session.adjust + session.hrAdjust)));
  if (force || w !== session.targetPower) {
    session.targetPower = w;
    device()?.setTarget({ power: w });
  }
}

/** Sends the step's incline plus what HR moved it (steps that follow HR by incline). */
function pushIncline() {
  const step = currentStep();
  if (!step) return;
  device()?.setTarget({ incline: step.incline + session.inclineAdjust }); // clamped by the treadmill
}

function sendSpeed(speed) {
  session.speedSentAt = session.totalElapsed;
  device()?.setTarget({ speed });
}

/** Sends the target speed if it changed (ramps and manual adjustments). */
export function pushTarget(force = false) {
  const step = currentStep();
  if (searching(step)) {
    // Nothing planned to go back to: the speed HR found goes again (a restart)
    if (force && session.target != null) sendSpeed(session.target);
    return;
  }
  if (!step?.hasTarget) { session.target = null; return; }
  if (!force) absorbConsole();
  const base = targetSpeedAt(step, stepProgress(step));
  const l = limits();
  const t = Math.round(Math.min(l.speedMax ?? Infinity, Math.max(l.speedMin ?? 0, base * intensityFactor(step, session.intensity) + session.adjust + session.hrAdjust)) * 10) / 10;
  if (force || t !== session.target) {
    session.target = t;
    sendSpeed(t);
  }
}

/** A step whose speed HR is finding, from wherever the belt is: nothing planned, on a treadmill. */
export const searching = (step) => session.hrOn && policy().kind === 'treadmill' && searchesSpeed(step);

/** The speed asked of the belt now: what the console reports includes the changes made on it. */
function beltTarget() {
  const reported = live.console.targetSpeed;
  return reported > 0 ? reported : session.target ?? live.speed;
}

/**
 * Workout intensity (#39): scales the watts or the speed (not the incline) of
 * this step and the next ones, before the manual and HR adjustments.
 */
export function setIntensity(pct) {
  const next = Math.min(INTENSITY_MAX, Math.max(INTENSITY_MIN, Math.round(pct)));
  if (next === session.intensity) return;
  session.intensity = next;
  if (session.stepStarts[session.stepIdx] != null) session.stepIntensity[session.stepIdx] = next;
  session.reason = `intensity ${next} %`;
  log('info', `Workout intensity ${next} %`);
  if (session.state === 'running' && currentStep()) {
    if (policy().kind === 'trainer') pushPower(); else pushTarget();
  }
  changed();
}

/**
 * Arms a session with the selected workout, or a free one. sport: the page
 * that starts it ('run' | 'ride'), which picks the device of a free session;
 * a workout's own sport wins.
 */
export function start({ sport = 'run' } = {}) {
  slowdown = null;
  resetSession();
  session.steps = app.state.selection ? app.state.selection.steps : [];
  session.event = app.state.selection ? app.state.selection.event : null;
  session.hrOn = !!app.state.selection?.hrOn;
  session.hrOnly = !!app.state.selection?.hrOnly;
  session.policy = policyFor(session.event, sport);
  session.stats.unit = actuator().unit;
  session.state = 'armed';
  events.emit('active', true);
  changed();
}

/**
 * Brings back a session saved before a reload (session/recovery.js, #36). One
 * unfinished comes back paused at its step and time, with its samples: moving
 * again resumes it and sends the target; the time away counts as a pause. One
 * finished comes back as it was, without saving its metrics again.
 */
export function restoreSession({ session: saved, sport, savedAt }) {
  slowdown = null;
  resetSession();
  Object.assign(session, saved, { policy: POLICIES[sport] ?? POLICIES.run, target: null, targetPower: null, stopSince: null, reason: null });
  rrState.pending = [];
  tick.wasMoving = false;
  if (session.state === 'done') {
    changed();
    return;
  }
  if (session.state === 'running') startPause(savedAt);
  session.state = 'paused';
  events.emit('active', true);
  changed();
}

/** Cancels a session that is armed but has not started (the belt never moved). */
export function cancel() {
  if (session.state !== 'armed') return;
  resetSession();
  events.emit('active', false);
  changed();
}

export function finish(message) {
  if (session.state === 'idle' || session.state === 'done') return;
  endPause(tick.last || Date.now());
  cue({ kind: 'end' });
  session.state = 'done';
  session.target = null;
  events.emit('active', false);
  log('info', message);
  note(message);
  if (session.steps.length) session.stepStarts[session.stepIdx + 1] ??= session.totalElapsed;
  if (session.testStart != null) {
    session.testEnd ??= session.totalElapsed;
    saveTestResult();
  } else {
    saveRunMetrics();
  }
  changed();
  beep(520, 0.6);
}

function startPause(now) {
  session.stats.pauses += 1;
  session.stats.pausedSince = now;
}

function endPause(now) {
  const c = session.stats;
  if (c.pausedSince != null) c.pausedMs += now - c.pausedSince;
  c.pausedSince = null;
}

export function tick(now = Date.now()) {
  updateAlpha();
  if (slowdown) slowDownStep(now);
  // Up to 5 s: with the tab hidden ticks may spread out without losing distance
  const dt = Math.min(5, (now - (tick.last || now)) / 1000);
  tick.last = now;
  // Without recent data from the device no distance is counted (and the session pauses)
  const pol = policy();
  if (isStale(device(), now)) pol.resetStale();
  const moving = pol.moving();
  const restarted = moving && !tick.wasMoving;
  tick.wasMoving = moving;

  if (session.state === 'armed' && moving) {
    session.state = 'running';
    session.startedAt = now;
    rrState.pending = []; // beats from before the start do not belong to the first sample
    log('info', pol.words.started);
    if (session.steps.length) applyStep(0);
    changed();
  } else if (session.state === 'running') {
    // The belt stopped and restarted before the auto-pause: the console
    // restarts at its own speed, so the target is resent
    if (restarted && currentStep()) sendStep(true);
    if (!moving) {
      session.stopSince ??= now;
      if (now - session.stopSince > AUTO_PAUSE_MS) {
        session.state = 'paused';
        startPause(now);
        cue({ kind: 'paused' });
        log('warn', pol.words.stopped);
        changed();
      }
    } else {
      session.stopSince = null;
    }
  } else if (session.state === 'paused' && moving) {
    session.state = 'running';
    session.stopSince = null;
    endPause(now);
    cue({ kind: 'resumed' });
    rrState.pending = [];
    log('info', pol.words.resumed);
    if (currentStep()) sendStep(true);
    changed();
  }

  if (session.state === 'running') {
    const meters = (pol.speed() / 3.6) * dt;
    session.totalElapsed += dt;
    session.totalDist += meters;
    session.stepElapsed += dt;
    session.stepDist += meters;

    // One sample per whole second of session time, on an exact grid: ticks
    // arrive a little late, and sampling "1 s after the last one" drifted
    // (~1.04 s apart, a second skipped every ~26 s), which made the pace
    // computed from distance and time spike in Strava. The distance at that
    // second is taken back from this tick at the current speed.
    while (session.totalElapsed >= session.nextSample) {
      const back = session.totalElapsed - session.nextSample; // s since that second
      const sample = {
        t: Math.round(now - back * 1000), elapsed: session.nextSample,
        distance: Math.max(0, session.totalDist - (pol.speed() / 3.6) * back),
        ...pol.sample(), hr: hrNow(), target: pol.kind === 'trainer' ? session.targetPower : session.target,
        ...sampleControl(),
      };
      // α1 only with RR: null = no value yet or bad signal
      if (rrActive()) {
        sample.alpha1 = rrState.alpha?.alpha1 ?? null;
        sample.rr = rrState.pending;
      }
      rrState.pending = [];
      session.samples.push(sample);
      session.nextSample += 1;
    }

    const step = currentStep();
    if (step) {
      if (step.duration) {
        const left = Math.ceil(step.duration - session.stepElapsed);
        const next = session.steps[session.stepIdx + 1];
        // Short steps go by too fast for it (and the first seconds of a step are its own)
        if (next && !session.nextCued && left <= NEXT_CUE_S && step.duration > 2 * NEXT_CUE_S) {
          session.nextCued = true;
          const carried = carriedFor(next);
          cue({ kind: 'next', step: next, factor: intensityFactor(next, session.intensity), offset: carried?.speed == null ? (carried?.hrAdjust ?? 0) + (carried?.adjust ?? 0) : 0, speed: carried?.speed ?? null });
        }
        if (left <= 3 && left >= 1 && session.lastBeep !== left) {
          session.lastBeep = left;
          beep(440, 0.12, true);
          cue({ kind: 'countdown', n: left });
        }
      }
      const testEnd = testOver(step);
      if (testEnd) {
        log('info', `Threshold test: ${testEnd}, ramp over`);
        const cd = session.steps.findIndex((s, i) => i > session.stepIdx && !s.test);
        applyStep(cd < 0 ? session.steps.length : cd);
      } else if (stepProgress(step) >= 1) applyStep(session.stepIdx + 1);
      else if (warmupDone(step)) {
        log('info', `HR ${live.hr} reached the top of Z1 (${zones().hr[0].hi}): warm-up done`);
        applyStep(session.stepIdx + 1);
      } else {
        if (pol.hrSteerable) {
          watchHr();
          adjustForHr(step);
        }
        if (step.ramp) sendStep();
      }
    }
  }

  events.emit('tick', now);
}

/**
 * A warm-up ramp ends early once HR has been at or above the top of Z1 for
 * WARMUP_HOLD_S: going on would only push HR further up before the main set.
 * Only before an aerobic step (Z1–Z2): harder sets keep the whole warm-up.
 */
function warmupDone(step) {
  const z = zones();
  if (!step.warmup || !step.ramp || !z?.hr.length || !live.hr) return false;
  const next = session.steps[session.stepIdx + 1];
  if (!next || next.zone == null || next.zone > 2) return false;
  if (live.hr < z.hr[0].hi) { session.warmupHrSince = null; return false; }
  session.warmupHrSince ??= session.stepElapsed;
  return session.stepElapsed - session.warmupHrSince >= WARMUP_HOLD_S;
}

/**
 * Threshold test ramp: why it should end now, or null. It ends once α1 has
 * stayed below TEST_STOP_ALPHA (just past VT2) or HR gets near max HR. On the
 * way it logs when α1 crosses VT1 and VT2.
 */
function testOver(step) {
  if (!step.test) return null;
  const a = rrActive() ? rrState.alpha?.alpha1 : null;
  for (const [name, limit] of [['VT1', VT1], ['VT2', VT2]]) {
    if (a != null && a < limit && !session.testMarks[name]) {
      session.testMarks[name] = true;
      log('info', `α1 ${a.toFixed(2)} with HR ${live.hr}: around ${name}`);
    }
  }
  const maxHr = zones()?.maxHr;
  if (maxHr && live.hr >= maxHr - 2) return `HR ${live.hr} near max HR ${maxHr}`;
  if (a == null || a >= TEST_STOP_ALPHA || session.totalElapsed - session.testStart < TEST_MIN_S) {
    session.testLowSince = null;
    return null;
  }
  session.testLowSince ??= session.totalElapsed;
  return session.totalElapsed - session.testLowSince >= TEST_STOP_HOLD_S ? `α1 below ${TEST_STOP_ALPHA}` : null;
}

/** Analyzes the threshold test that just ended and keeps it in the history (Profile). */
function saveTestResult() {
  const result = analyzeRamp(session.samples, session.testStart, session.testEnd, policy().sport);
  const peakHr = Math.max(0, ...session.samples.map((s) => s.hr || 0));
  if (result.error) {
    session.testError = result.error;
    log('warn', `Threshold test: ${result.error}`);
    note(` ${t('tests.failed', { error: result.error })}`, true);
    return;
  }
  session.testResult = result;
  addTest({ ...result, peakHr });
  const text = testText(result);
  log('info', `Threshold test: ${text} (r² ${result.r2}, ${result.points} points)`);
  note(` ${t('tests.result', { result: text })}`, true);
  events.emit('test', { result });
}

/**
 * Steady aerobic runs and rides (#4): Pa:HR (Pw:HR) decoupling and HR at
 * VT1 from α1, saved to the history and told in the note. Nothing for other
 * sessions.
 */
function saveRunMetrics() {
  const sport = policy().sport;
  const summary = aerobicSummary(session.samples, session.steps, sport);
  if (!summary) return;
  session.aerobic = summary;
  addRun({ name: session.event?.name ?? null, ...summary });
  const text = runText(summary);
  const { first, second } = summary.decoupling;
  const halves = sport === 'ride' ? `${first.w} W at ${first.hr} → ${second.w} at ${second.hr}` : `${first.kmh} km/h at ${first.hr} → ${second.kmh} at ${second.hr}`;
  log('info', `Aerobic ${sport}: ${text} (${halves}${summary.vt1 ? `; VT1 r² ${summary.vt1.r2}, ${summary.vt1.bands} HR bands` : ''})`);
  note(` ${t(sport === 'ride' ? 'aerobic.resultRide' : 'aerobic.result', { result: text })}`, true);
  events.emit('run', { summary });
}

/**
 * What the control was doing in a sample, so a CSV alone explains the
 * session (#10): the step, the HR range it followed, the speed HR added or
 * removed, and why speed changed (only on the second it did).
 */
function sampleControl() {
  const step = currentStep();
  const hr = session.hrOn && step?.hr && step.hr.mode !== 'info' ? step.hr : null;
  const reason = session.reason;
  session.reason = null;
  return { step: step ? session.stepIdx + 1 : null, hrLo: hr?.lo ?? null, hrHi: hr?.hi ?? null, hrAdjust: session.hrAdjust, reason, intensity: session.intensity };
}

/**
 * The α1 guard: on once the median α1 of the last ALPHA_HOLD_S seconds is
 * below VT1, off again only once the median of the last ALPHA_RELEASE_S is
 * above ALPHA_RELEASE. A median, not "every value below": α1 near VT1 has
 * single readings above it (0.98, 0.89 among 0.6s on 2026-10-30), and each
 * one restarted the count, so the guard came on 3 min late (#10). Without α1
 * (no strap, bad signal), or if the athlete chose the HR range only, it is off.
 */
function alphaGuard() {
  const a = rrActive() ? rrState.alpha?.alpha1 : null;
  const now = session.totalElapsed;
  if (session.hrOnly || a == null || now < ALPHA_MIN_S) { session.alphaGuard = false; return false; }
  const span = session.alphaGuard ? ALPHA_RELEASE_S : ALPHA_HOLD_S;
  const recent = session.samples.filter((s) => s.elapsed > now - span && s.elapsed >= ALPHA_MIN_S && s.alpha1 != null).map((s) => s.alpha1);
  if (recent.length < span * 0.75) return session.alphaGuard; // not enough of the window yet
  const median = recent.sort((x, y) => x - y)[Math.floor(recent.length / 2)];
  if (!session.alphaGuard && median < VT1) {
    session.alphaGuard = true;
    session.stats.alphaGuards += 1;
    if (session.hrOn) cue({ kind: 'alpha', on: true });
    if (session.hrOn) log('info', `α1 ${median.toFixed(2)} (median of ${ALPHA_HOLD_S} s) below ${VT1}: no rises on aerobic steps until it is above ${ALPHA_RELEASE}`);
  } else if (session.alphaGuard && median > ALPHA_RELEASE) {
    session.alphaGuard = false;
    if (session.hrOn) cue({ kind: 'alpha', on: false });
    if (session.hrOn) log('info', `α1 ${median.toFixed(2)} (median of ${ALPHA_RELEASE_S} s) above ${ALPHA_RELEASE}: α1 guard off`);
  }
  return session.alphaGuard;
}

/**
 * HR lost during a session that follows it (#50): the target holds, and after
 * HR_LOST_TELL_S the athlete is told. After HR_LOST_PLAN_S it goes back to
 * the plan, without what HR had added or removed; with nothing planned it
 * stays. When HR returns, control waits its grace again.
 */
function watchHr() {
  if (!session.hrOn) return;
  if (hrNow()) {
    session.hrSeen = true;
    if (session.hrLostAt == null) return;
    log('info', 'HR is back: HR control resumes after its grace');
    if (session.hrLostTold) cue({ kind: 'link', state: 'hr-back' });
    Object.assign(session, { hrLostAt: null, hrLostTold: false, hrFellBack: false, hrBackAt: session.totalElapsed, hrOutSince: null, hrWantDir: 0 });
    changed();
    return;
  }
  if (!session.hrSeen) return;
  session.hrLostAt ??= session.totalElapsed;
  session.hrLostInStep = true;
  const lost = session.totalElapsed - session.hrLostAt;
  if (lost >= HR_LOST_TELL_S && !session.hrLostTold) {
    session.hrLostTold = true;
    session.reason = 'HR lost: target held';
    log('warn', 'HR lost: the target holds');
    cue({ kind: 'link', state: 'hr-lost' });
    changed();
  }
  if (lost >= HR_LOST_PLAN_S && !session.hrFellBack) {
    session.hrFellBack = true;
    if (searching(currentStep())) return;
    session.hrAdjust = 0;
    session.inclineAdjust = 0;
    session.reason = 'HR lost: back to the plan';
    log('warn', 'HR lost for a minute: back to the plan, without the HR adjustment');
    cue({ kind: 'link', state: 'hr-plan' });
    sendStep();
  }
}

/**
 * Speed adjustment by HR, once per tick while a step runs (the decision is
 * in session/hr-control.js).
 * - Step with a pace target ('cap'): speed drops when HR is heading above
 *   the top of the matching zone; once HR is back below, it returns.
 * - Step with an HR target ('target'): speed moves to keep HR in the middle
 *   of the range (lower on aerobic steps). Inside Z1 it works like a cap.
 * - Aerobic steps (Z1–Z2, not the warm-up nor the cool-down): while the α1
 *   guard is on speed never rises, and with HR above Z1 it also drops, at
 *   most every ALPHA_DROP_SPACING_S.
 * The same correction must be asked for HR_HOLD_S in a row, and at least
 * HR_SPACING_S pass between adjustments (HR_RISE_SPACING_S between rises),
 * because HR responds with a lag.
 */
function adjustForHr(step) {
  const guard = alphaGuard();
  const search = searching(step);
  const hr = hrNow();
  if (!session.hrOn || !step.hr || step.hr.mode === 'info' || !(step.hasTarget || step.power || search) || !hr) return;
  if (session.hrBackAt != null && session.totalElapsed - session.hrBackAt < HR_GRACE_S) return;
  const t = session.stepElapsed;
  if (t < (step.hr.settle ?? HR_GRACE_S)) return;
  const { lo, hi } = step.hr;
  // A step inside Z1 is an easy one: HR may still be coming down from the effort before it,
  // and no planned recovery reaches its aim in time. Only its top counts (with HR, not the search)
  const easy = step.hr.mode === 'target' && !search && step.hr.by !== 'incline' && hi <= zones()?.hr[0]?.hi;
  const mode = easy ? 'cap' : step.hr.mode;
  const recent = session.samples.filter((s) => s.elapsed > session.totalElapsed - SLOPE_WINDOW_S);
  const trend = hrTrend(recent);
  const a = actuator();
  const where = { zone: step.zone, warmup: step.warmup, cooldown: step.cooldown, hr, z1Top: zones()?.hr[0]?.hi };
  const veto = guard && alphaVetoApplies(where);
  const spaced = session.alphaLastDrop == null || session.totalElapsed - session.alphaLastDrop >= ALPHA_DROP_SPACING_S;
  const { delta, reason, alpha, far } = hrDecision({
    mode, lo, hi, hr: trend?.level ?? hr, project: trend?.rising ?? true, slope: hrSlope(recent), hrAdjust: session.hrAdjust,
    alphaVeto: veto, alphaDrop: veto && spaced && alphaDropApplies(where), giveBack: !step.cooldown,
    aim: mode === 'target' && step.zone != null && step.zone <= 2 ? AEROBIC_AIM : 0.5, search,
  }, a);
  const dir = Math.sign(delta);
  if (!dir) { session.hrOutSince = null; session.hrWantDir = 0; return; }
  if (dir !== session.hrWantDir) { session.hrWantDir = dir; session.hrOutSince = t; }
  if (t - session.hrOutSince < HR_HOLD_S) return;
  const byIncline = step.hr.by === 'incline';
  if (session.hrLastAdjust != null && t - session.hrLastAdjust < (byIncline ? INCLINE_SPACING_S : HR_SPACING_S)) return;
  if (dir > 0 && session.hrLastRise != null && t - session.hrLastRise < (far ? SEARCH_RISE_SPACING_S : HR_RISE_SPACING_S)) return;
  if (byIncline) {
    // The incline moves within the treadmill's range; speed stays as planned
    const l = limits();
    const next = Math.min((l.inclineMax ?? Infinity) - step.incline, Math.max((l.inclineMin ?? 0) - step.incline, session.inclineAdjust + inclineStep(delta)));
    if (next === session.inclineAdjust) return;
    const applied = next - session.inclineAdjust;
    session.inclineAdjust = next;
    session.stats.inclineMoves += 1;
    log('info', `${reason}: incline ${applied > 0 ? '+' : '−'}${Math.abs(applied).toFixed(1)} %, now ${(step.incline + next).toFixed(1)} %`);
    pushIncline();
  } else {
    // Speed on a treadmill, watts on a trainer, within the step's limits
    // A search has no plan to stay close to: only the belt's limits and its ceiling
    const maxUp = mode === 'target' ? a.maxUp : 0;
    const l = limits();
    const before = search ? beltTarget() : session.hrAdjust;
    const next = search
      ? roundTo(Math.min(l.speedMax ?? Infinity, SEARCH_MAX_KMH, Math.max(l.speedMin ?? 0, before + delta)), a.decimals)
      : roundTo(Math.min(maxUp, Math.max(-a.maxDown, before + delta)), a.decimals);
    if (next === before) return;
    const applied = roundTo(next - before, a.decimals);
    session.hrAdjust = search ? roundTo(session.hrAdjust + applied, a.decimals) : next;
    if (applied > 0) { session.stats.hrRises += 1; session.stats.hrUp = roundTo(session.stats.hrUp + applied, a.decimals); }
    else { session.stats.hrDrops += 1; session.stats.hrDown = roundTo(session.stats.hrDown - applied, a.decimals); }
    cue({ kind: 'hr', delta: applied, unit: a.unit });
    const what = a === POWER ? 'power' : 'speed';
    log('info', `${reason}: ${what} ${applied > 0 ? '+' : '−'}${Math.abs(applied).toFixed(a.decimals)} ${a.unit}, HR adjustment ${session.hrAdjust > 0 ? '+' : ''}${session.hrAdjust.toFixed(a.decimals)}`);
    if (search) { session.target = next; sendSpeed(next); }
    else if (a === POWER) pushPower(); else pushTarget();
  }
  session.hrLastAdjust = t;
  if (dir > 0) session.hrLastRise = t;
  if (alpha) session.alphaLastDrop = session.totalElapsed;
  session.reason = reason;
  session.hrOutSince = null;
  session.hrWantDir = 0;
}

/**
 * A device came back after a drop (#37). The target goes again once it is
 * moving, by the same paths as a restart: never to a belt the athlete
 * stopped, and the session resumes on the next movement. Only the session's
 * own device; a strap has no target.
 */
export function deviceBack(kind) {
  if (isActive() && kind === policy().kind) tick.wasMoving = false;
}

/** Says that a device was lost, came back or was given up on (#37), for the voice. */
export const announceLink = (state) => cue({ kind: 'link', state });

/** Whether a session needs this device now: its treadmill or trainer, or the strap. */
export const needsDevice = (kind) => isActive() && (kind === 'hr' || kind === policy().kind);

// Closing or reloading the page during an active workout asks the belt to
// pause, on beforeunload and again on pagehide (ui/run.js wires both). It may
// not get there: on 2026-11-04 a reload left the belt running (#61).
// If you stay, the session remains paused: START on the console resumes it.
let unloadPausedAt = 0;
export function pauseOnClose(onProgress) {
  // Also while the belt slows down after the end: nobody will be there to pause it
  if ((!isActive() && !slowdown) || !device()?.connected) return;
  slowdown = null;
  if (Date.now() - unloadPausedAt < 1000) return;
  unloadPausedAt = Date.now();
  device().pauseNow(onProgress);
}

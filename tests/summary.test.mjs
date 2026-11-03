// The session summary in the activity description (#35)
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionSummary, uploadDescription } from '../src/session/summary.js';
import { startSession, runStep } from './session/harness.mjs';

const Z2 = { lo: 131, hi: 145, mode: 'target' };
const rideStep = (o) => ({ label: 'Step', duration: 600, hasTarget: false, speedStart: null, speedEnd: null, incline: 0, power: { lo: 130, hi: 140 }, zone: 2, hr: null, ...o });
const stats = (o = {}) => ({ unit: 'W', hrRises: 0, hrDrops: 0, hrUp: 0, hrDown: 0, inclineMoves: 0, alphaGuards: 0, pauses: 0, pausedMs: 0, cooldownFrom: null, ...o });

test('summary: a ride by HR tells rises, drops, the α1 guard, Pw:HR, pauses and the cool-down', () => {
  const text = sessionSummary({
    hrOn: true, samples: [], rpe: 6, feel: 2,
    stats: stats({ hrRises: 6, hrUp: 30, alphaGuards: 2, pauses: 3, pausedMs: 72000, cooldownFrom: 105 }),
    aerobic: { sport: 'ride', decoupling: { pct: 4.2 }, vt1: { hr: 119 } },
  });
  assert.deepEqual(text.split('\n'), [
    'HR control: 6 rises (+30 W), 0 drops · α1 guard 2×',
    'Pw:HR 4.2 % (aerobic base held) · VT1 ≈ 119 bpm (α1)',
    'Paused 3× (1:12) · Cool-down started at 105 W',
    'RPE 6 · Feel 2 · Good',
  ]);
});

test('summary: a run in km/h, with drops and the incline', () => {
  const text = sessionSummary({ hrOn: true, samples: [], stats: stats({ unit: 'km/h', hrDrops: 1, hrDown: 0.5, inclineMoves: 2 }) });
  assert.equal(text, 'HR control: 0 rises, 1 drop (−0.5 km/h) · HR moved the incline 2×');
});

test('summary: without HR control, metrics or events the lines are left out', () => {
  assert.equal(sessionSummary({ hrOn: false, samples: [{ intensity: 100 }], stats: stats({ alphaGuards: 3 }) }), '');
});

test('summary: a threshold test, or why it failed', () => {
  const vt = (hr, kmh) => ({ hr, kmh });
  const ok = sessionSummary({ samples: [], stats: stats(), testResult: { vt1: vt(140, 9), vt2: vt(165, 12) } });
  assert.match(ok, /^Threshold test: VT1 140 bpm at 6:40\/km · VT2 165 bpm at 5:00\/km$/);
  assert.equal(sessionSummary({ samples: [], stats: stats(), testError: 'Not enough α1 values' }), 'Threshold test: Not enough α1 values');
});

test('summary: the intensity, or its range if it changed', () => {
  assert.equal(sessionSummary({ samples: [{ intensity: 95 }, { intensity: 95 }], stats: stats() }), 'Intensity 95 %');
  assert.equal(sessionSummary({ samples: [{ intensity: 100 }, { intensity: 92 }], stats: stats() }), 'Intensity 92–100 %');
});

test('summary: a setting turns it off; the page\'s sentence stays', () => {
  const s = { samples: [{ intensity: 95 }], stats: stats() };
  assert.equal(uploadDescription('Ride on a KICKR.', s), 'Ride on a KICKR.\n\nIntensity 95 %');
  assert.equal(uploadDescription('Ride on a KICKR.', s, { summary: false }), 'Ride on a KICKR.');
  assert.equal(uploadDescription('Ride on a KICKR.', { samples: [], stats: stats() }), 'Ride on a KICKR.');
});

test('summary: the session counts HR moves, pauses and the cool-down start', () => {
  const h = startSession({ sport: 'ride', hrOn: true, steps: [
    rideStep({ hr: Z2, duration: 300, power: { lo: 150, hi: 150 } }),
    rideStep({ cooldown: true, ramp: true, power: { lo: 140, hi: 100 }, duration: 60 }),
  ] });
  h.run(100, { hr: 165 });
  h.run(10, { cadence: 0, hr: 165 });
  assert.equal(h.session.state, 'paused');
  h.run(205, { hr: 165 });
  const c = h.session.stats;
  assert.equal(c.unit, 'W');
  assert.equal(c.pauses, 1);
  assert.ok(c.pausedMs >= 7000 && c.pausedMs <= 9000, `paused ${c.pausedMs}`);
  assert.ok(c.hrDrops >= 2);
  assert.equal(c.hrDown, 150 - (h.session.stepIdx === 1 ? c.cooldownFrom : h.session.targetPower));
  h.session.state === 'running' && h.runner.endSession('end');
  assert.match(sessionSummary(h.session), /^HR control: 0 rises, \d+ drops \(−\d+ W\)\nPaused 1× \(0:\d\d\) · Cool-down started at \d+ W$/);
});

test('summary: a free session with nothing to tell adds nothing', () => {
  const h = startSession({ free: true, steps: [] });
  h.run(20);
  h.runner.endSession('end');
  assert.equal(sessionSummary(h.session), '');
  assert.equal(h.session.stats.unit, 'km/h');
});

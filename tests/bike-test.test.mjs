// α1 threshold test on the bike (#40)
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRamp } from '../src/physiology/thresholds.js';
import { flattenWorkout } from '../src/workouts/steps.js';
import { resolveDoc, rideFromIntervals, rideWithVt2, rideZones } from '../src/physiology/zones.js';
import { testText, vtText, lastWithVt2 } from '../src/session/test-history.js';
import { sessionSummary } from '../src/session/summary.js';
import { LIBRARY } from './fixtures.mjs';
import { startSession, RIDE_SETTINGS } from './session/harness.mjs';
import { events } from '../src/session/runner.js';

/** A ramp: +1 W every 6 s, HR rises with watts, α1 falls with the mean HR of its 2 min window (VT1 at 150 bpm, VT2 at 170). */
function rampSamples({ noise = 0 } = {}) {
  return Array.from({ length: 1200 }, (_, i) => {
    const w = 100 + i / 6;
    const hr = 100 + (w - 100) * 0.5 + 25;
    const meanHr = hr - 5; // HR climbs 5 bpm/min: the window's mean is a minute behind
    const alpha = 0.75 - ((meanHr - 150) * 0.25) / 20;
    return { elapsed: i, hr, speed: 30, power: w, cadence: 90, alpha1: i < 120 ? null : Math.round((alpha + noise * Math.sin(i)) * 100) / 100 };
  });
}

test('bike test: a synthetic ramp gives VT1 and VT2 in bpm and watts', () => {
  const r = analyzeRamp(rampSamples(), 120, 1200, 'ride');
  assert.equal(r.sport, 'ride');
  assert.ok(Math.abs(r.vt1.hr - 150) <= 3, `VT1 ${r.vt1.hr}`);
  assert.ok(Math.abs(r.vt2.hr - 170) <= 3, `VT2 ${r.vt2.hr}`);
  assert.ok(Math.abs(r.vt1.w - 150) <= 12, `VT1 ${r.vt1.w} W`);
  assert.ok(Math.abs(r.vt2.w - 190) <= 12, `VT2 ${r.vt2.w} W`);
  assert.ok(Number.isInteger(r.vt1.w));
  assert.equal(r.vt1.kmh, undefined);
  assert.ok(r.r2 > 0.9);
});

test('bike test: the same errors as a treadmill test; an extrapolated VT2 is marked', () => {
  const samples = rampSamples();
  assert.match(analyzeRamp(samples.map((s) => ({ ...s, alpha1: null })), 120, 1200, 'ride').error, /chest strap/);
  assert.match(analyzeRamp(samples, 120, 200, 'ride').error, /too early|Not enough/);
  const r = analyzeRamp(samples.filter((s) => s.alpha1 == null || s.alpha1 >= 0.55), 120, 1200, 'ride');
  assert.equal(r.vt2.extrapolated, true);
});

test('bike test: a run still reads speed', () => {
  const samples = rampSamples().map((s) => ({ ...s, speed: 8 + s.elapsed / 300, incline: 0, power: undefined }));
  const r = analyzeRamp(samples, 120, 1200);
  assert.equal(r.sport, 'run');
  assert.ok(r.vt1.kmh > 8);
  assert.equal(r.vt1.w, undefined);
});

test('bike test: the library entry warms up, ramps 5 % of FTP a minute in locked test steps and cools down', () => {
  const entry = LIBRARY.find((w) => w.id === 'alpha-test-ride');
  assert.equal(entry.sport, 'ride');
  const zones = { ...rideZones(rideFromIntervals(RIDE_SETTINGS)), pace: [] };
  const steps = flattenWorkout(resolveDoc(entry.workout_doc, zones, 'ride'), { zones, hrTargets: true });
  assert.ok(steps[0].warmup);
  assert.ok(steps.at(-1).cooldown);
  const ramp = steps.filter((s) => s.test);
  assert.equal(ramp.length, 17);
  assert.deepEqual(ramp.slice(0, 3).map((s) => s.power.lo), [100, 110, 120], '+10 W a minute at FTP 200');
  assert.equal(ramp.at(-1).power.lo, 260);
  assert.ok(ramp.every((s) => s.hr == null || s.hr.mode === 'info'), 'HR never steers the ramp');
});

function bikeTest() {
  const entry = LIBRARY.find((w) => w.id === 'alpha-test-ride');
  const zones = { ...rideZones(rideFromIntervals(RIDE_SETTINGS)), pace: [] };
  const steps = flattenWorkout(entry.workout_doc, { zones });
  return startSession({ sport: 'ride', steps });
}

/** HR and α1 of a rider on the ramp: α1 crosses 0.75 at 150 bpm and 0.5 at 170. */
const hrAt = (t) => (t < 600 ? 110 + (t / 600) * 20 : 130 + ((t - 600) / 60) * 3.5);
const alphaAt = (t) => Math.round((1.0 - ((hrAt(t - 60) - 130) * 0.5) / 40) * 100) / 100;

test('bike test: in a session it ends by itself past VT2, goes to the cool-down and saves W and bpm', () => {
  const h = bikeTest();
  const results = [];
  events.on('test', ({ result }) => results.push(result));
  h.run(600 + 15 * 60, { hr: hrAt, alpha1: alphaAt });
  assert.ok(h.session.steps[h.session.stepIdx].cooldown, `on ${h.session.steps[h.session.stepIdx].label}`);
  assert.ok(h.session.testEnd < 600 + 15 * 60, `ended at ${h.session.testEnd}`);
  h.run(320, { hr: 110 });
  assert.equal(h.session.state, 'done');
  const r = results.at(-1);
  assert.equal(r.sport, 'ride');
  assert.ok(r.vt1.w > 100 && r.vt1.w < 260, JSON.stringify(r));
  assert.ok(r.vt2.w > r.vt1.w);
  assert.ok(r.vt2.hr > r.vt1.hr);
  assert.match(sessionSummary(h.session), /^Threshold test: VT1 \d+ bpm at \d+ W · VT2 \d+ bpm at \d+ W/);
});

test('bike test: it stops near the cycling max HR, not the running one', () => {
  const h = startSession({ sport: 'ride', steps: [
    { label: 'Ramp', duration: 600, test: true, hasTarget: false, power: { lo: 150, hi: 150 }, zone: 3, hr: null, incline: 0 },
    { label: 'Cool-down', duration: 60, cooldown: true, hasTarget: false, power: { lo: 100, hi: 100 }, zone: 1, hr: null, incline: 0 },
  ] });
  h.run(30, { hr: 182 }); // running max HR is 185; the harness' cycling profile has none
  assert.equal(h.session.stepIdx, 0, 'no cycling max HR: it keeps going');
});

test('bike test: how results read, and which one the profile uses', () => {
  assert.equal(vtText({ hr: 120, w: 155 }), '120 bpm at 155 W');
  assert.equal(testText({ vt1: { hr: 120, w: 155 }, vt2: { hr: 150, w: 210, extrapolated: true } }), 'VT1 120 bpm at 155 W · VT2 150 bpm at 210 W (extrapolated)');
  const tests = [{ sport: 'ride', vt2: { hr: 150, w: 210 } }, { vt2: { hr: 165, kmh: 12 } }, { sport: 'ride', vt2: null }];
  assert.equal(lastWithVt2(tests, 'run').vt2.hr, 165, 'an old entry with no sport is a run');
  assert.equal(lastWithVt2(tests, 'ride').vt2.w, 210);
  assert.equal(lastWithVt2([{ sport: 'ride', vt2: null }], 'ride'), null);
});

test('bike test: VT2 becomes the indoor FTP and LTHR of the cycling settings, keeping the rest', () => {
  const ride = rideFromIntervals({ ...RIDE_SETTINGS, ftp: 200, lthr: 160 });
  const next = rideWithVt2(ride, { hr: 150, w: 210 });
  assert.equal(next.indoorFtp, 210);
  assert.equal(next.ftp, 200, 'the outdoor FTP stays');
  assert.equal(next.lthr, 150);
  assert.deepEqual(next.hrZones, ride.hrZones);
  assert.equal(rideZones(next).ftp, 210);
  const none = rideWithVt2(null, { hr: 150, w: 210 });
  assert.equal(rideZones(none).ftp, 210);
  assert.equal(rideZones(none).power.length > 0, true);
});

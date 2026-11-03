// Intervals.icu workout_doc → treadmill steps, and the workout library
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenWorkout, followsHr, targetSpeedAt, formatPace, formatDuration } from '../src/workouts/steps.js';
import { zonesFromProfile, profileFromIntervals, resolveDoc, rideFromIntervals, rideZones } from '../src/physiology/zones.js';
import { parseDur } from '../src/workouts/library.js';
import { inclineStep } from '../src/session/hr-control.js';
import { sportOf } from '../src/services/intervals.js';
import { easyRun, runSettings, LIBRARY } from './fixtures.mjs';

test('flattenWorkout expands repeats', () => {
  const steps = flattenWorkout(easyRun);
  assert.equal(steps.length, 6);
  assert.deepEqual(steps.map((s) => s.duration), [180, 540, 60, 540, 60, 120]);
  assert.match(steps[1].label, /1\/2/);
  assert.match(steps[3].label, /2\/2/);
});

test('flattenWorkout: speed by position within the zone', () => {
  const kmh = (pos) => flattenWorkout(easyRun, { position: pos })[1].speedStart;
  assert.equal(kmh('low'), 7.5);   // 2.0946 m/s
  assert.equal(kmh('high'), 8.5);  // 2.3703 m/s
  assert.equal(kmh('mid'), 8.0);
});

test('flattenWorkout: base incline and incline from text', () => {
  const doc = { steps: [
    { duration: 60, text: 'incline 3%', _pace: { value: 2.5 } },
    { duration: 60, text: '2% incl', _pace: { value: 2.5 } },
    { duration: 60, _pace: { value: 2.5 } },
    { duration: 60, text: 'inclinación 12', _pace: { value: 2.5 } },
  ] };
  // The plan keeps what the workout says (12 %); the treadmill's limits apply when it is sent
  assert.deepEqual(flattenWorkout(doc, { defaultIncline: 1 }).map((s) => s.incline), [3, 2, 1, 12]);
});

test('flattenWorkout: ramps, distance and steps without a target', () => {
  const doc = { steps: [
    { duration: 300, ramp: true, _pace: { start: 2, end: 3 } },
    { distance: 1000, _pace: { value: 3 } },
    { duration: 120, hr: { units: 'hr_zone', value: 2 } },
  ] };
  const [ramp, dist, free] = flattenWorkout(doc);
  assert.equal(ramp.speedStart, 7.2);
  assert.equal(ramp.speedEnd, 10.8);
  assert.equal(targetSpeedAt(ramp, 0.5), 9);
  assert.equal(dist.distance, 1000);
  assert.equal(dist.duration, null);
  assert.equal(free.hasTarget, false);
  assert.equal(targetSpeedAt(free, 0.5), null);
});

test('formats', () => {
  assert.equal(formatPace(10), '6:00');
  assert.equal(formatPace(9.73), '6:10');
  assert.equal(formatPace(0), '--:--');
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('flattenWorkout: absolute pace without a zone is labeled with the pace', () => {
  const [s] = flattenWorkout({ steps: [{ duration: 5, pace: { units: 'secs/km', value: 720 }, _pace: { value: 5 / 3.6 } }] });
  assert.match(s.label, /pace 12:00\/km/);
  assert.equal(s.speedStart, 5);
});

test('flattenWorkout with zones: HR cap on pace steps and speed on HR steps', () => {
  const zones = zonesFromProfile(profileFromIntervals(runSettings));
  const doc = { steps: [
    { duration: 600, pace: { units: 'pace_zone', value: 2 }, _pace: { start: 7.6 / 3.6, end: 8.4 / 3.6 } },
    { duration: 600, hr: { units: 'hr_zone', value: 2 } },
    { duration: 60 },
  ] };
  const [pace, hr, free] = flattenWorkout(doc, { zones });
  assert.deepEqual(pace.hr, { lo: 135, hi: 150, mode: 'cap' });
  assert.equal(pace.zone, 2);
  assert.deepEqual(hr.hr, { lo: 135, hi: 150, mode: 'target' });
  assert.ok(hr.hasTarget && hr.speedStart > 7.5 && hr.speedStart < 8.6, String(hr.speedStart));
  assert.match(hr.label, /HR 135–150 \(Z2\)/);
  assert.equal(free.hr, null);
  assert.equal(free.hasTarget, false);
});

test('resolveDoc: % of threshold with the profile and the full library', () => {
  const zones = zonesFromProfile({ ...profileFromIntervals(runSettings), thresholdKmh: 10 });
  const doc = resolveDoc({ steps: [{ duration: 60, pace: { units: '%pace', value: 90 } }] }, zones);
  assert.equal(Math.round(doc.steps[0]._pace.value * 3.6 * 10) / 10, 9);
  for (const w of LIBRARY.filter((x) => x.sport === 'run')) {
    const steps = flattenWorkout(resolveDoc(w.workout_doc, zones), { zones });
    assert.ok(steps.length > 2, w.id);
    assert.ok(steps.every((s) => s.hasTarget && s.speedStart > 0 && s.speedStart < 20), w.id); // plan speeds, no device range
  }
  const hills = flattenWorkout(resolveDoc(LIBRARY.find((w) => w.id === 'hills-45-2').workout_doc, zones), { zones });
  assert.deepEqual([...new Set(hills.map((s) => s.incline))].sort(), [0, 1, 5]);
});

test('library: incline walk at Z2', () => {
  const zones = zonesFromProfile(profileFromIntervals(runSettings));
  const w = LIBRARY.find((x) => x.id === 'walk-incline-45-3');
  const steps = flattenWorkout(resolveDoc(w.workout_doc, zones), { zones });
  assert.equal(steps.reduce((a, s) => a + s.duration, 0), 45 * 60);
  assert.ok(steps.every((s) => s.speedStart === 5 && !s.ramp));        // fixed 12:00/km
  assert.equal(steps[0].duration, 300);
  assert.equal(steps[0].incline, 2);
  assert.deepEqual(steps.slice(1, 17).map((s) => s.incline), [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10]);
  assert.ok(steps.slice(1, 17).every((s) => s.duration === 60));
  assert.equal(steps.at(-1).incline, 10);
  assert.equal(steps.at(-1).duration, 24 * 60);
  // Z2 HR is the goal, but speed never changes
  assert.equal(steps[0].hr, null);
  assert.ok(steps.slice(1).every((s) => s.hr.mode === 'info' && s.hr.hi === 150));
});

test('library: every combination lasts what it says and levels go up', () => {
  assert.equal(parseDur('1m30s'), 90);
  assert.equal(parseDur('90s'), 90);
  assert.throws(() => parseDur('2 min'));
  const secs = (steps) => steps.reduce((a, s) => a + (s.steps ? s.reps * secs(s.steps) : s.duration), 0);
  const generated = LIBRARY.filter((w) => !w.featured);
  assert.equal(generated.filter((w) => w.sport === 'run').length, 9 * 3 * 5);
  assert.equal(generated.filter((w) => w.sport === 'ride').length, 5 * 3 * 5);
  for (const w of generated) assert.equal(secs(w.workout_doc.steps), w.minutes * 60, w.id);
  // Work time grows with level in interval sessions
  const zones = zonesFromProfile(profileFromIntervals(runSettings));
  for (const type of ['tempo', 'threshold', 'vo2']) {
    for (const m of [30, 45, 60]) {
      const work = [1, 2, 3, 4, 5].map((lv) => {
        const steps = flattenWorkout(resolveDoc(LIBRARY.find((w) => w.id === `${type}-${m}-${lv}`).workout_doc, zones), { zones });
        return steps.filter((s) => s.speedStart >= zones.thresholdKmh * 0.89).reduce((a, s) => a + s.duration, 0);
      });
      for (let i = 1; i < 5; i++) assert.ok(work[i] >= work[i - 1], `${type} ${m} min: ${work}`);
    }
  }
});

test('flattenWorkout marks warm-up steps (they end early at the top of Z1)', () => {
  const steps = flattenWorkout(LIBRARY.find((w) => w.id === 'hr-z2').workout_doc);
  assert.deepEqual(steps.map((s) => s.warmup), [true, false, false]);
  assert.equal(steps[0].ramp, true);
});

test('library: hrControl flag only on workouts HR can steer', () => {
  const flagged = new Set(LIBRARY.filter((w) => w.hrControl).map((w) => w.type));
  assert.deepEqual([...flagged].sort(), ['aerobic', 'ride-endurance', 'tempo', 'walk-hr']);
  assert.equal(LIBRARY.find((w) => w.id === 'hr-z2').hrControl, true);
  assert.equal(LIBRARY.find((w) => w.id === 'progressive').hrControl, false);
  assert.ok(LIBRARY.filter((w) => w.type === 'vo2' || w.type === 'hills').every((w) => !w.hrControl));
});

test('flattenWorkout with hrTargets: long steps follow their HR zone, short ones keep the pace', () => {
  const zones = zonesFromProfile({ ...profileFromIntervals(runSettings), thresholdKmh: 10 });
  const doc = resolveDoc(LIBRARY.find((w) => w.id === 'tempo-45-3').workout_doc, zones);
  const steps = flattenWorkout(doc, { zones, hrTargets: true });
  const [wu, work, rec] = steps;
  assert.equal(wu.hr.mode, 'cap');
  assert.deepEqual(work.hr, { lo: zones.hr[2].lo, hi: zones.hr[2].hi, mode: 'target', settle: 150 });
  assert.equal(work.speedStart, 9.2);                // starts at the planned pace
  assert.match(work.label, /HR \d+–\d+ \(Z3\)/);
  assert.equal(rec.hr, null);                        // 2′ recovery: pace only
  assert.equal(steps.at(-1).hr.mode, 'cap');         // cooldown
  // Without hrTargets nothing changes
  assert.equal(flattenWorkout(doc, { zones })[1].hr.mode, 'cap');
  // Aerobic Z2: the whole block, without the Z3 settle time
  const z2 = flattenWorkout(resolveDoc(LIBRARY.find((w) => w.id === 'aerobic-45-3').workout_doc, zones), { zones, hrTargets: true });
  assert.deepEqual(z2[1].hr, { lo: zones.hr[1].lo, hi: zones.hr[1].hi, mode: 'target' });
});

test('followsHr: Intervals workouts without a flag are judged by their steps', () => {
  const zones = zonesFromProfile({ ...profileFromIntervals(runSettings), thresholdKmh: 10 });
  const judge = (id) => followsHr(flattenWorkout(resolveDoc(LIBRARY.find((w) => w.id === id).workout_doc, zones), { zones }));
  assert.equal(judge('aerobic-45-3'), true);
  assert.equal(judge('tempo-45-3'), true);
  assert.equal(judge('hr-z2'), true);
  assert.equal(judge('vo2-45-3'), false);
  assert.equal(judge('threshold-45-3'), false);
  assert.equal(judge('hills-45-3'), false);
  assert.equal(judge('aerobic-45-5'), false);       // strides at 100 %
});

test('Z2 walk by incline: HR target moved by the incline, speed fixed', () => {
  const zones = zonesFromProfile({ ...profileFromIntervals(runSettings), thresholdKmh: 10 });
  const steps = flattenWorkout(resolveDoc(LIBRARY.find((w) => w.id === 'walk-hr-45-3').workout_doc, zones), { zones, hrTargets: true });
  const main = steps[1];
  assert.deepEqual(main.hr, { lo: 135, hi: 150, mode: 'target', by: 'incline' });
  assert.equal(main.incline, 4);
  assert.equal(main.speedStart, 5.5);                       // 11:00/km
  assert.match(main.label, /by incline/);
  assert.equal(steps[0].hr, null);                         // warm-up walk: locked
  assert.equal(inclineStep(0), 0);
  assert.equal(inclineStep(-0.2), -0.5);
  assert.equal(inclineStep(0.5), 1);
});

test('sportOf: runs and rides from Intervals.icu, other sports skipped', () => {
  assert.equal(sportOf('Run'), 'run');
  assert.equal(sportOf('VirtualRun'), 'run');
  assert.equal(sportOf('Ride'), 'ride');
  assert.equal(sportOf('VirtualRide'), 'ride');
  assert.equal(sportOf('Swim'), null);
  assert.equal(sportOf('WeightTraining'), null);
});

test('flattenWorkout: bike steps get watts and a power zone from the cycling zones', () => {
  const ride = rideZones(rideFromIntervals({ ftp: 200, hr_zones: [130, 145, 155, 165, 175, 185] }));
  const z = { hr: ride.hr, pace: [], power: ride.power, ftp: ride.ftp };
  const doc = { steps: [
    { duration: 600, warmup: true, power: { start: 50, end: 65, units: '%ftp' } },
    { reps: 2, steps: [
      { duration: 300, power: { value: 4, units: 'power_zone' }, hr: { value: 4, units: 'hr_zone' } },
      { duration: 120, power: { value: 120, units: 'w' } },
    ] },
  ] };
  const steps = flattenWorkout(doc, { zones: z });
  assert.equal(steps.length, 5);
  assert.deepEqual(steps[0].power, { lo: 100, hi: 130 });
  assert.equal(steps[0].zone, 2);   // 115 W: Z2 is 111–150 W
  assert.deepEqual(steps[1].power, { lo: 181, hi: 210 });
  assert.equal(steps[1].zone, 4);
  // An HR target on a bike step is followed with the watts (it was information only before the trainer)
  assert.deepEqual(steps[1].hr, { lo: 156, hi: 165, mode: 'target' });
  assert.match(steps[1].label, /HR 156–165 \(Z4\)/);
  assert.equal(steps[2].zone, 2);
  assert.match(steps[2].label, /· 120 W$/);
  // A power step gets the HR zone in the same position as a cap; the warm-up too
  assert.deepEqual(steps[2].hr, { lo: ride.hr[1].lo, hi: ride.hr[1].hi, mode: 'cap' });
  assert.equal(steps[0].hr.mode, 'cap');
  assert.ok(steps.every((s) => !s.hasTarget && s.intensity));
  // Without cycling zones the zone still comes from the % FTP defaults
  assert.equal(flattenWorkout(doc)[0].zone, 2);
});

test('flattenWorkout keeps the warm-up and cool-down flags (the #10 cool-down rules need them)', () => {
  const steps = flattenWorkout({ steps: [
    { duration: 300, warmup: true, _pace: { value: 2 } },
    { duration: 600, _pace: { value: 2.5 } },
    { duration: 300, cooldown: true, _pace: { value: 2 } },
  ] });
  assert.deepEqual(steps.map((s) => [s.warmup, s.cooldown]), [[true, false], [false, false], [false, true]]);
});

test('library: bike workouts in % of FTP or power zones, with their own warm-up and cool-down', () => {
  const ride = rideZones(rideFromIntervals({ ftp: 200, hr_zones: [130, 145, 155, 165, 175, 185] }));
  const z = { hr: ride.hr, pace: [], power: ride.power, ftp: ride.ftp };
  const rides = LIBRARY.filter((w) => w.sport === 'ride');
  assert.ok(rides.length >= 75);
  for (const w of rides) {
    const steps = flattenWorkout(w.workout_doc, { zones: z });
    assert.ok(steps.every((s) => s.power && s.power.lo > 0 && s.power.hi < 300 && !s.hasTarget), w.id);
    assert.ok(steps[0].warmup && steps.at(-1).cooldown, w.id);
  }
  const z2 = flattenWorkout(LIBRARY.find((w) => w.id === 'ride-endurance-45-3').workout_doc, { zones: z });
  assert.deepEqual(z2[1].power, { lo: 126, hi: 140 });   // 63–70 % of 200 W
  assert.equal(z2[0].ramp, true);
  // The featured Z2 ride by HR: HR target in Z2, starting from power zone 2
  const byHr = flattenWorkout(LIBRARY.find((w) => w.id === 'ride-z2-hr').workout_doc, { zones: z, hrTargets: true });
  assert.equal(byHr[1].hr.mode, 'target');
  assert.deepEqual([byHr[1].hr.lo, byHr[1].hr.hi], [ride.hr[1].lo, ride.hr[1].hi]);
  assert.deepEqual(byHr[1].power, { lo: ride.power[1].lo, hi: ride.power[1].hi });
  // Long aerobic blocks follow HR with the adjustment on; short hard ones keep their watts
  const tempo = flattenWorkout(LIBRARY.find((w) => w.id === 'ride-tempo-60-3').workout_doc, { zones: z, hrTargets: true });
  assert.equal(tempo[1].hr.mode, 'target');
  assert.equal(tempo[1].hr.settle, 150);
  const vo2 = flattenWorkout(LIBRARY.find((w) => w.id === 'ride-vo2-45-3').workout_doc, { zones: z, hrTargets: true });
  assert.ok(vo2.filter((s) => s.kind === 'Work').every((s) => s.hr?.mode !== 'target'));
});

test('#31: a run written in power zones gets the pace zone in the same position; a ride keeps the watts', () => {
  const zones = zonesFromProfile({ ...profileFromIntervals(runSettings), thresholdKmh: 10 });
  // "caco 9+1" (2026-10-31): Intervals.icu used power as the default target of "z1" / "z2"
  const z = (n) => ({ power: { value: n, units: 'power_zone' }, _power: { start: 136, end: 170 } });
  const doc = { steps: [
    { duration: 300, warmup: true, ...z(1) },
    { reps: 2, steps: [{ duration: 540, ...z(2) }, { duration: 60, ...z(1) }] },
    { duration: 120, power: { start: 80, end: 90, units: '%ftp' } },
    { duration: 60, power: { value: 250, units: 'power' } },
    { duration: 60, power: { value: 2, units: 'power_zone' }, hr: { value: 2, units: 'hr_zone' } },
  ] };
  const run = flattenWorkout(resolveDoc(doc, zones, 'run'), { zones });
  const byPace = (n) => flattenWorkout(resolveDoc({ steps: [{ duration: 540, pace: { value: n, units: 'pace_zone' } }] }, zones), { zones })[0].speedStart;
  assert.ok(run.every((s) => s.power == null), 'no bike steps on a run');
  assert.equal(run[1].speedStart, byPace(2));
  assert.equal(run[0].speedStart, byPace(1));
  assert.deepEqual([run[5].speedStart, run[5].speedEnd], [8.5, 8.5]); // 80–90 % of FTP → 85 % of a 10 km/h threshold, at the middle
  assert.equal(run[6].hasTarget, false, 'absolute watts: a free step');
  assert.equal(run[7].hr.mode, 'target', 'the HR target wins over the power one');
  // The same doc as a ride (or without a sport) keeps its watts
  const ride = flattenWorkout(resolveDoc(doc, zones, 'ride'), { zones });
  assert.ok(ride[1].power && ride[1].speedStart == null);
  assert.ok(flattenWorkout(resolveDoc(doc, zones), { zones })[1].power);
});

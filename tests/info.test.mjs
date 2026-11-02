import test from 'node:test';
import assert from 'node:assert/strict';
import { workoutSeconds, hrControllable } from '../src/workouts/info.js';
import { zonesFromProfile, profileFromIntervals } from '../src/physiology/zones.js';
import { easyRun, runSettings } from './fixtures.mjs';

test('info: workoutSeconds counts repeats', () => {
  assert.equal(workoutSeconds(easyRun), 180 + 2 * (540 + 60) + 120);
  assert.equal(workoutSeconds({ steps: [{ reps: 3, steps: [{ duration: 60 }, { reps: 2, steps: [{ duration: 10 }] }] }] }), 3 * (60 + 20));
  assert.equal(workoutSeconds(null), 0);
});

test('info: hrControllable — library flag, and runs and rides judged by their steps', () => {
  const zones = zonesFromProfile(profileFromIntervals(runSettings));
  assert.equal(hrControllable({ hrControl: true, workout_doc: { steps: [] } }, zones), true);
  assert.equal(hrControllable({ hrControl: false, workout_doc: easyRun }, zones), false);
  // Rides are judged by their steps too (watts are the actuator): a long Z2 block can follow HR, VO2 repeats cannot
  const ride = { hr: zones.hr, pace: [], power: [{ z: 1, lo: 0, hi: 110 }, { z: 2, lo: 111, hi: 150 }, { z: 3, lo: 151, hi: 180 }, { z: 4, lo: 181, hi: 210 }, { z: 5, lo: 211, hi: Infinity }], ftp: 200 };
  const z2 = { steps: [{ duration: 1800, power: { units: '%ftp', start: 63, end: 70 } }] };
  const vo2 = { steps: [{ reps: 5, steps: [{ duration: 180, power: { units: '%ftp', value: 115 } }, { duration: 180, power: { units: '%ftp', value: 50 } }] }] };
  assert.equal(hrControllable({ sport: 'ride', workout_doc: z2 }, ride), true);
  assert.equal(hrControllable({ sport: 'ride', workout_doc: vo2 }, ride), false);
  // Easy Run 9+1: two 9′ Z2 steps, long enough for HR control
  assert.equal(hrControllable({ sport: 'run', workout_doc: easyRun }, zones), true);
  // Only short steps: nothing for HR to steer
  const short = { steps: [{ duration: 60, pace: { value: 2, units: 'pace_zone' }, _pace: { start: 2.09, end: 2.37 } }] };
  assert.equal(hrControllable({ sport: 'run', workout_doc: short }, zones), false);
});

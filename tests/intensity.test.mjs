// Global workout intensity (#39), in the session harness
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession, runStep } from './session/harness.mjs';
import { samplesToCsv } from '../src/export/csv.js';
import { planTimeline } from '../src/ui/session-screen.js';
import { intensityFactor } from '../src/session/policies.js';

const rideStep = (o) => ({ label: 'Step', duration: 120, hasTarget: false, speedStart: null, speedEnd: null, incline: 0, power: { lo: 171, hi: 171 }, zone: 2, hr: null, ...o });

test('intensity: at 95 % a 171 W step asks 162 W, and the next step is scaled as well', () => {
  const h = startSession({ sport: 'ride', steps: [rideStep({}), rideStep({ power: { lo: 200, hi: 200 } })] });
  h.run(5);
  assert.equal(h.powers().at(-1).power, 171);
  h.runner.setIntensity(95);
  assert.equal(h.powers().at(-1).power, 162);
  h.run(125);
  assert.equal(h.session.stepIdx, 1);
  assert.equal(h.powers().at(-1).power, 190);
  assert.equal(h.session.samples.at(-1).intensity, 95);
});

test('intensity: a run scales speed and keeps the incline', () => {
  const h = startSession({ steps: [runStep({ speedStart: 10, speedEnd: 10, incline: 3 })] });
  h.run(5, { speed: 10 });
  const inclines = h.sent.filter((s) => s.incline != null).length;
  h.runner.setIntensity(90);
  assert.equal(h.speeds().at(-1).speed, 9);
  assert.equal(h.sent.filter((s) => s.incline != null).length, inclines, 'no incline sent');
  assert.equal(h.session.reason, 'intensity 90 %');
});

test('intensity: it stays between 70 and 120 %', () => {
  const h = startSession({ steps: [runStep({})] });
  h.run(3);
  h.runner.setIntensity(40);
  assert.equal(h.session.intensity, 70);
  h.runner.setIntensity(150);
  assert.equal(h.session.intensity, 120);
});

test('intensity: a cool-down never goes above the plan, and comes down with it', () => {
  assert.equal(intensityFactor({ cooldown: true }, 110), 1);
  assert.equal(intensityFactor({ cooldown: true }, 90), 0.9);
  assert.equal(intensityFactor({}, 110), 1.1);
  const steps = [rideStep({ duration: 10 }), rideStep({ cooldown: true, power: { lo: 100, hi: 100 } })];
  const up = startSession({ sport: 'ride', steps });
  up.runner.setIntensity(110);
  up.run(15);
  assert.equal(up.session.stepIdx, 1);
  assert.equal(up.powers().at(-1).power, 100);
  const down = startSession({ sport: 'ride', steps });
  down.runner.setIntensity(90);
  down.run(15);
  assert.equal(down.powers().at(-1).power, 90);
});

test('intensity: the manual and HR adjustments are added after the scaling', () => {
  const h = startSession({ sport: 'ride', steps: [rideStep({ power: { lo: 200, hi: 200 }, duration: 600 })] });
  h.run(3);
  h.session.adjust = 5;
  h.session.hrAdjust = -10;
  h.runner.setIntensity(90);
  assert.equal(h.powers().at(-1).power, 175); // 180 + 5 − 10
});

test('intensity: HR control keeps working on top of it', () => {
  const Z2 = { lo: 131, hi: 145, mode: 'target' };
  const h = startSession({ sport: 'ride', hrOn: true, steps: [rideStep({ power: { lo: 200, hi: 200 }, hr: Z2, duration: 600 })] });
  h.run(2, { hr: 136 });
  h.runner.setIntensity(90);
  assert.equal(h.powers().at(-1).power, 180);
  h.run(100, { hr: 170 });
  assert.ok(h.session.hrAdjust < 0, 'HR high: it takes watts away');
  assert.equal(h.powers().at(-1).power, 180 + h.session.hrAdjust);
});

test('intensity: the CSV has it, and the chart scales the steps to come while steps done keep theirs', () => {
  const h = startSession({ steps: [
    runStep({ duration: 60, speedStart: 10, speedEnd: 10 }),
    runStep({ duration: 60, speedStart: 10, speedEnd: 10 }),
    runStep({ duration: 60, speedStart: 10, speedEnd: 10, cooldown: true }),
  ] });
  h.run(65, { speed: 10 });
  h.runner.setIntensity(110);
  h.run(2, { speed: 11 });
  const plan = planTimeline();
  assert.equal(plan[0].speedStart, 10, 'done at 100 %');
  assert.equal(plan[1].speedStart, 11);
  assert.equal(plan[2].speedStart, 10, 'the cool-down stays at the plan');
  const csv = samplesToCsv(h.session.samples).split('\n');
  assert.match(csv[0], /,intensity_pct$/);
  assert.match(csv.at(-1), /,110$/);
  assert.match(csv[1], /,100$/);
});

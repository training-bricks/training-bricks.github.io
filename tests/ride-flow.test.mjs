// Ride sessions on a smart trainer (#7) and HR-controlled ERG (#8), in Node with a fake trainer and clock
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession } from './session/harness.mjs';

/** A bike step in ERG: watts { lo, hi } (steady: the middle), power zone, optional HR range. */
const rideStep = (o) => ({ label: o.label ?? 'Step', duration: 600, hasTarget: false, speedStart: null, speedEnd: null, incline: 0, power: { lo: 130, hi: 140 }, zone: 2, hr: null, ...o });
const Z2 = { lo: 131, hi: 145, mode: 'target' };       // ride HR Z2 of the harness profile; Z1 tops at 130
const gaps = (list) => list.slice(1).map((x, i) => x.at - list[i].at);

test('ride: an ERG workout starts with pedaling, sends each step\'s watts and releases the trainer at the end', () => {
  const h = startSession({ sport: 'ride', steps: [
    rideStep({ label: 'Warm-up', warmup: true, ramp: true, power: { lo: 100, hi: 140 }, duration: 60 }),
    rideStep({ label: 'Z2', duration: 60 }),
  ] });
  assert.equal(h.session.state, 'armed');
  h.run(1, { cadence: 0 });
  assert.equal(h.session.state, 'armed', 'not pedaling yet');
  h.run(30, { cadence: 90 });
  assert.equal(h.session.state, 'running');
  const ramp = h.powers();
  assert.equal(ramp[0].power, 100);
  assert.ok(ramp.at(-1).power > 110 && ramp.at(-1).power < 125, 'the warm-up ramp climbs');
  h.run(40);
  assert.equal(h.session.stepIdx, 1);
  assert.equal(h.powers().at(-1).power, 135);           // steady step: the middle
  h.run(70);
  assert.equal(h.session.state, 'done');
  assert.ok(h.sent.at(-1).stop, 'the trainer is released');
  const s = h.session.samples.at(-1);
  assert.deepEqual([s.power, s.cadence, s.target], [135, 90, 135]);
});

test('ride: stopping pedaling pauses the session, pedaling again resumes it', () => {
  const h = startSession({ sport: 'ride', steps: [rideStep({ duration: 300 })] });
  h.run(20);
  h.run(5, { cadence: 0 });
  assert.equal(h.session.state, 'paused');
  h.run(3);
  assert.equal(h.session.state, 'running');
});

test('ride (#8): HR above the target lowers the watts after the grace, spaced, at most −40 W', () => {
  const h = startSession({ sport: 'ride', steps: [rideStep({ hr: Z2, duration: 1200 })], hrOn: true });
  h.run(54, { hr: 160 });
  assert.equal(h.powers().length, 1, 'nothing before 45 s grace + 10 s hold');
  h.run(800, { hr: 160 });
  const drops = h.powers().slice(1);
  assert.ok(drops.length >= 3);
  assert.ok(gaps(drops).every((g) => g >= 25), `spacing ${gaps(drops)}`);
  assert.ok(drops.every((d, i) => d.power < (i ? drops[i - 1].power : 135)));
  assert.ok(drops.every((d, i) => (i ? drops[i - 1].power : 135) - d.power <= 15), 'at most 15 W a correction');
  assert.equal(Math.min(...drops.map((d) => d.power)), 95);   // 135 − 40
});

test('ride (#8): HR below the target raises the watts by at most 5 W, 60 s apart, up to +30', () => {
  const h = startSession({ sport: 'ride', steps: [rideStep({ hr: Z2, duration: 1500 })], hrOn: true });
  h.run(1400, { hr: 120 });
  const rises = h.powers().slice(1);
  assert.ok(rises.length >= 5);
  assert.ok(gaps(rises).every((g) => g >= 60), `spacing ${gaps(rises)}`);
  assert.ok(rises.every((r, i) => r.power - (i ? rises[i - 1].power : 135) <= 5));
  assert.equal(Math.max(...rises.map((r) => r.power)), 165);  // 135 + 30
});

test('ride (#8): α1 vetoes rises and drops watts on a Z2 ride, with the cycling zones (Z1 tops at 130, not the running 134)', () => {
  // HR 132: Z2 on the bike, Z1 for running. With the running zones the α1 drop would not act.
  const h = startSession({ sport: 'ride', steps: [rideStep({ hr: Z2, duration: 1500 })], hrOn: true });
  h.run(600, { hr: 132, alpha1: 0.5 });
  // α1 counts from 120 s and the guard needs most of a minute of it: from then on, only 5 W drops, 90 s apart
  const all = h.powers();
  const sp = all.filter((x) => x.at >= 165);
  assert.ok(sp.length >= 3, `α1 drops: ${JSON.stringify(all)}`);
  assert.ok(sp.every((x) => all[all.indexOf(x) - 1].power - x.power === 5), `only 5 W drops: ${JSON.stringify(all)}`);
  assert.ok(gaps(sp).every((g) => g >= 90), `spacing ${gaps(sp)}`);
});

test('ride: a free ride from the Ride page drives the trainer (no workout)', () => {
  const h = startSession({ sport: 'ride', free: true, steps: [] });
  assert.equal(h.session.policy.kind, 'trainer');
  h.run(10);
  assert.equal(h.session.state, 'running');
  assert.ok(h.session.samples.at(-1).cadence === 90);
});

test('ride: the cool-down starts no harder than the main step ended', () => {
  const h = startSession({ sport: 'ride', hrOn: true, steps: [
    rideStep({ label: 'Z2', hr: Z2, duration: 300, power: { lo: 150, hi: 150 } }),
    rideStep({ label: 'Cool-down', cooldown: true, ramp: true, power: { lo: 140, hi: 100 }, duration: 300, hr: { ...Z2, mode: 'cap' } }),
  ] });
  h.run(300, { hr: 160 });                              // HR high: the main step comes down
  const ended = h.session.targetPower;
  assert.ok(ended < 140, `main step ended at ${ended} W`);
  h.run(3, { hr: 120 });
  assert.equal(h.session.stepIdx, 1);
  assert.equal(h.session.targetPower, ended);
  h.run(200, { hr: 110 });
  assert.ok(h.powers().filter((x) => x.at > 300).every((x) => x.power <= ended), 'and no give-back');
});

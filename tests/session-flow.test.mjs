// Whole sessions in Node with a fake clock: steps, stale data, and the HR
// control rules tuned in #10 (spacing, limits, no rise while climbing, α1 guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession, runStep } from './session/harness.mjs';
import { parseSessionCsv, replay } from './session/replay.mjs';
import { samplesToCsv } from '../src/export/csv.js';
import { live, rrState, hrNow } from '../src/session/live.js';
import * as runner from '../src/session/runner.js';

const Z2 = { lo: 135, hi: 150, mode: 'target' };   // Z2 of the fixture profile; Z1 tops at 134
const gaps = (list) => list.slice(1).map((x, i) => x.at - list[i].at);

test('flow: skip moves on, stale data counts no distance and pauses', () => {
  const h = startSession({ steps: [runStep({ speedStart: 8, speedEnd: 8 }), runStep({ speedStart: 10, speedEnd: 10 })] });
  h.run(10, { speed: 8 });
  assert.equal(h.session.state, 'running');
  h.runner.applyStep(1);                         // what Skip does
  assert.equal(h.session.stepIdx, 1);
  assert.equal(h.speeds().at(-1).speed, 10);
  const dist = h.session.totalDist;
  h.stale(4, { speed: 10 });                     // the device stopped reporting
  assert.ok(h.session.totalDist - dist < 10, 'no distance once readings are stale');
  h.stale(3, { speed: 10 });
  assert.equal(h.session.state, 'paused');
});

test('flow: HR above the target drops speed after the grace, spaced, at most −2 km/h', () => {
  const h = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  h.run(54, { hr: 160 });
  assert.equal(h.speeds().length, 1, 'nothing before 45 s grace + 10 s hold');
  h.run(400, { hr: 160 });
  const drops = h.speeds().slice(1);
  assert.ok(drops.length >= 2);
  assert.ok(drops[0].at >= 55);
  assert.ok(gaps(drops).every((g) => g >= 25), `spacing ${gaps(drops)}`);
  assert.ok(drops.every((d, i) => d.speed < (i ? drops[i - 1].speed : 9)));
  assert.equal(Math.min(...drops.map((d) => d.speed)), 7);   // 9 − 2.0
});

test('flow: HR below the target rises by at most 0.2 km/h, 60 s apart, up to +1.5', () => {
  const h = startSession({ steps: [runStep({ hr: Z2, duration: 1200 })], hrOn: true });
  h.run(1100, { hr: 125 });
  const rises = h.speeds().slice(1);
  assert.ok(rises.length >= 5);
  assert.ok(gaps(rises).every((g) => g >= 60), `spacing ${gaps(rises)}`);
  assert.ok(rises.every((r, i) => Math.round((r.speed - (i ? rises[i - 1].speed : 9)) * 10) / 10 <= 0.2));
  assert.equal(Math.max(...rises.map((r) => r.speed)), 10.5); // 9 + 1.5
});

test('flow: no rise while HR is still climbing', () => {
  const h = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  h.run(150, { hr: (t) => 110 + 0.1 * t });     // under the aim, but rising 6 bpm/min
  assert.equal(h.speeds().length, 1);
});

test('flow: α1 guard slows an aerobic step once α1 is trusted (120 s) and low for most of a minute, but not in the warm-up or under Z1', () => {
  const aerobic = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  aerobic.run(160, { hr: 141, alpha1: 0.6 });   // HR on the aim (40 % of Z2): only α1 can move it
  assert.equal(aerobic.speeds().length, 1);
  aerobic.run(40, { hr: 141, alpha1: 0.6 });
  const drop = aerobic.speeds()[1];
  assert.ok(drop && drop.at >= 165, 'drop after ALPHA_MIN_S + 45 s of α1 (¾ of the minute) + the 10 s hold');
  assert.equal(drop.speed, 8.8);

  const warmup = startSession({ steps: [runStep({ hr: { ...Z2, mode: 'cap' }, warmup: true })], hrOn: true });
  warmup.run(300, { hr: 141, alpha1: 0.6 });
  assert.equal(warmup.speeds().length, 1, 'no α1 drop in the warm-up');

  const underZ1 = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  underZ1.run(300, { hr: (t) => (t < 60 ? 125 : 132), alpha1: 0.6 });
  assert.ok(underZ1.speeds().every((s) => s.speed >= 9), 'no α1 drop with HR under the top of Z1');
});

test('flow: a warm-up ramp ends once HR holds the top of Z1', () => {
  const h = startSession({ steps: [
    runStep({ label: 'Warm-up', warmup: true, ramp: true, speedStart: 7, speedEnd: 8, zone: 1 }),
    runStep({ label: 'Z2', speedStart: 9, speedEnd: 9, zone: 2 }),
  ] });
  h.run(20, { hr: 120 });
  assert.equal(h.session.stepIdx, 0);
  h.run(8, { hr: 136 });
  assert.equal(h.session.stepIdx, 1);
});

test('flow (#10): a short HR dip does not justify a rise; a long one does', () => {
  // Replayed through Brickwise's own CSV export
  const series = (dip) => Array.from({ length: 260 }, (_, s) => ({
    elapsed: s, distance: s * 2.5, speed: 9, incline: 1,
    hr: s >= 200 && s < 200 + dip ? 137 : 142,
  }));
  for (const [dip, rises] of [[8, 0], [15, 0], [25, 1]]) {
    const h = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
    replay(h, parseSessionCsv(samplesToCsv(series(dip))));
    const sp = h.speeds();
    const up = sp.filter((x, i) => i && x.speed > sp[i - 1].speed).length;
    assert.equal(up, rises, `dip of ${dip} s: ${JSON.stringify(sp)}`);
  }
});

test('flow (#10, 2026-10-30): HR at the Z1/Z2 boundary with low α1 no longer saws ±0.2', () => {
  // HR swings 132 (Z1) ↔ 136 (Z2) every 40 s with α1 ≈ 0.5: the HR target rose in Z1, the α1 guard dropped in Z2
  const h = startSession({ steps: [runStep({ hr: { lo: 135, hi: 148, mode: 'target' }, duration: 1500 })], hrOn: true });
  h.run(1400, { hr: (t) => (Math.floor(t / 40) % 2 ? 136 : 132), alpha1: 0.5 });
  // α1 counts from 120 s and the guard needs most of a minute of it: from then on, only drops
  const all = h.speeds();
  const sp = all.filter((x) => x.at >= 180);
  const rises = sp.filter((x) => x.speed > all[all.indexOf(x) - 1].speed);
  assert.equal(rises.length, 0, `no rise once α1 is low: ${JSON.stringify(all)}`);
  assert.ok(sp.length >= 3, 'α1 still brings speed down');
  assert.ok(gaps(sp).every((g) => g >= 90), `α1 drops at least 90 s apart: ${gaps(sp)}`);
});

test('flow: with the HR range only, a low α1 neither slows the belt nor blocks rises', () => {
  const steps = [runStep({ hr: { lo: 135, hi: 150, mode: 'target' }, zone: 2, duration: 900 })];
  const h = startSession({ steps, hrOn: true, hrOnly: true });
  h.run(400, { hr: 125, alpha1: 0.5 });
  assert.equal(h.session.alphaGuard, false);
  assert.equal(h.session.stats.alphaGuards, 0);
  assert.ok(h.speeds().at(-1).speed > 9, `HR under the range still raises speed: ${JSON.stringify(h.speeds())}`);
});

test('flow (#10): the α1 guard turns off only once the median α1 of a minute is above 0.80', () => {
  const h = startSession({ steps: [runStep({ hr: Z2, duration: 1500 })], hrOn: true });
  h.run(200, { hr: 130, alpha1: 0.6 });                   // guard on from ~165 s (HR in Z1: no drop)
  assert.equal(h.session.alphaGuard, true);
  const before = h.speeds().length;                       // rises before α1 counted are allowed
  h.run(300, { hr: 130, alpha1: 0.78 });                  // above VT1 but under the release
  assert.equal(h.session.alphaGuard, true);
  assert.equal(h.speeds().length, before, 'no rise while the guard is on');
  h.run(20, { hr: 130, alpha1: 0.85 });                  // a third of the minute: the median is still low
  assert.equal(h.session.alphaGuard, true);
  h.run(90, { hr: 130, alpha1: 0.85 });
  assert.equal(h.session.alphaGuard, false);
  assert.ok(h.speeds().length > before, 'HR under the aim can rise again');
});

test('flow (#10): single α1 readings above VT1 do not keep the guard off', () => {
  // 2026-10-30, 9–12 min: α1 0.55–0.7 with readings of 0.98, 0.89, 0.82 every half minute
  const h = startSession({ steps: [runStep({ hr: Z2, duration: 1500 })], hrOn: true });
  h.run(240, { hr: 130, alpha1: (t) => (t % 30 < 5 ? 0.95 : 0.6) });
  assert.equal(h.session.alphaGuard, true);
});

test('flow (#10): the cool-down starts no faster than the main step ended, and gives nothing back', () => {
  const h = startSession({ steps: [
    runStep({ label: 'Z2', hr: Z2, duration: 300 }),
    runStep({ label: 'Cool-down', cooldown: true, ramp: true, speedStart: 8.5, speedEnd: 7.5, duration: 300, hr: { ...Z2, mode: 'cap' } }),
  ], hrOn: true });
  h.run(300, { hr: 160 });                                // HR high: the main step comes down
  const ended = h.session.samples.at(-1).target;
  assert.ok(ended < 8.5, `main step ended at ${ended}`);
  h.run(5, { hr: 130 });
  assert.equal(h.session.stepIdx, 1);
  assert.equal(h.session.target, ended, 'cool-down starts where the main step ended');
  h.run(200, { hr: 120 });                                // HR well under the cap: no give-back in the cool-down
  assert.ok(h.speeds().filter((x) => x.at > 300).every((x) => x.speed <= ended));
});

test('flow: a ramp down from the zone the step before ended in keeps its pace, and gives nothing back (2026-11-06)', () => {
  const z2 = (o = {}) => runStep({ label: 'Z2', hr: Z2, zone: 2, zoneStart: 2, zoneEnd: 2, duration: 300, speedStart: 8, speedEnd: 8, ...o });
  const down = { label: 'Easy', ramp: true, speedStart: 8, speedEnd: 6.5, duration: 300, zone: 2, zoneStart: 2, zoneEnd: 1, hr: { lo: 135, hi: 134, mode: 'cap' } };
  const h = startSession({ steps: [z2(), runStep(down)], hrOn: true });
  h.run(300, { hr: 160 });                                // HR high: the main step comes down
  const ended = h.session.samples.at(-1).target;
  assert.ok(ended < 8, `main step ended at ${ended}`);
  h.run(5, { hr: 130 });
  assert.equal(h.session.stepIdx, 1);
  assert.equal(h.session.target, ended, 'the ramp starts where the main step ended');
  h.run(200, { hr: 115 });                                // HR well under the cap: the drop is not given back
  assert.ok(h.speeds().filter((x) => x.at > 300).every((x) => x.speed <= ended));

  const up = startSession({ steps: [z2(), z2({ label: 'Z2 b', speedStart: 7.6, speedEnd: 7.6 })], hrOn: true });
  up.run(300, { hr: 125 });                               // HR low: the first step goes up
  const high = up.session.samples.at(-1).target;
  assert.ok(high > 8, `first step ended at ${high}`);
  up.run(3, { hr: 140 });
  assert.equal(up.session.target, high, 'up too, over a lower plan');
});

test('flow: a step starts where the last step in its zone ended; a zone not run yet, or no HR, starts from the plan', () => {
  const step = (zone, speed, hr, o = {}) => runStep({ label: `Z${zone}`, speedStart: speed, speedEnd: speed, zone, zoneStart: zone, zoneEnd: zone, duration: 300, hr: { ...hr, mode: 'target' }, ...o });
  const z2 = (o) => step(2, 8, Z2, o);
  const z4 = () => step(4, 11, { lo: 160, hi: 170 });
  const h = startSession({ steps: [z2(), z4(), z2(), z4(), z2()], hrOn: true });
  h.run(300, { hr: 160 });                                // Z2 comes down
  const z2Ended = h.session.samples.at(-1).target;
  assert.ok(z2Ended < 8);
  h.run(3, { hr: 150 });
  assert.equal(h.session.target, 11, 'Z4 not run yet: its plan');
  h.run(297, { hr: 150 });                                // HR low for Z4: it goes up
  const z4Ended = h.session.samples.at(-1).target;
  assert.ok(z4Ended > 11);
  h.run(3, { hr: 160 });
  assert.equal(h.session.target, z2Ended, 'the rest starts where the last Z2 ended');
  h.run(297, { hr: 160 });                                // and comes down more
  const restEnded = h.session.samples.at(-1).target;
  assert.ok(restEnded < z2Ended);
  h.run(3, { hr: 150 });
  assert.equal(h.session.target, z4Ended, 'the second Z4 starts where the first ended');
  h.run(300, { hr: 165 });
  assert.equal(h.session.target, restEnded, 'the last rest where the one before ended');

  const plain = startSession({ steps: [step(2, 8, Z2, { duration: 60 }), step(2, 8.5, Z2, { duration: 60 })] });
  plain.run(62, { speed: 7 });
  assert.equal(plain.speeds().at(-1).speed, 8.5, 'no HR: the plan stands');
});

test('csv (#10): step, HR range, HR adjustment and the reason of each change', () => {
  const h = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  h.run(80, { hr: 160 });
  const csv = samplesToCsv(h.session.samples).split('\n');
  assert.match(csv[0], /,step,hr_lo,hr_hi,hr_adjust,reason,power_w,cadence_rpm,target_w,intensity_pct$/);
  const changed = csv.filter((l) => /aiming at/.test(l));
  assert.equal(changed.length, 1);
  assert.match(changed[0], /,1,135,150,-0\.5,"?HR → \d+, aiming at 141"?,,,,100$/);
});

test('flow: at the end the belt slows down to its lowest speed, 0.5 km/h every 2 s, holds 3 s, then pauses', () => {
  const h = startSession({ steps: [runStep({ duration: 30, speedStart: 6, speedEnd: 6 })] });
  h.run(31, { speed: 6 });
  assert.equal(h.session.state, 'done');
  assert.ok(!h.sent.some((x) => x.pause), 'no pause from running speed');
  assert.equal(h.sent.at(-1).speed, 5.5);
  const t0 = h.sent.length;
  h.run(30, { speed: 6 });                                // the speed reading lags: it does not matter
  const after = h.sent.slice(t0 - 1);
  assert.deepEqual(after.filter((x) => x.speed != null).map((x) => x.speed), [5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.8]);
  assert.ok(after.at(-1).pause, 'then it pauses');
  assert.equal(h.sent.filter((x) => x.pause).length, 1);

  // A belt already at its lowest speed pauses at once
  const walk = startSession({ steps: [runStep({ duration: 20, speedStart: 0.8, speedEnd: 0.8 })] });
  walk.run(21, { speed: 0.8 });
  assert.ok(walk.sent.at(-1).pause);
});

test('flow: the slow-down stops if the belt is paused from the console, and the page closing pauses at once', () => {
  const h = startSession({ steps: [runStep({ duration: 20 })] });
  h.run(21, { speed: 9 });
  h.run(3, { speed: 0 });                                 // PAUSE on the console
  h.run(30, { speed: 0 });
  assert.ok(!h.sent.some((x) => x.pause), 'nothing more is sent');

  const c = startSession({ steps: [runStep({ duration: 20 })] });
  c.run(23, { speed: 9 });
  c.runner.pauseOnClose();
  assert.ok(c.sent.at(-1).pauseNow, 'closing the page while slowing down pauses the belt');
  const n = c.sent.length;
  c.run(30, { speed: 9 });
  assert.equal(c.sent.length, n, 'and the slow-down is over');
});

const search = (o = {}) => runStep({ hasTarget: false, speedStart: null, speedEnd: null, duration: 1800, hr: { lo: 146, hi: 153, mode: 'target' }, ...o });
const belt = (h, from) => () => h.speeds().at(-1)?.speed ?? from;

test('flow: an HR step with no planned speed starts from the belt and rises 0.5 km/h every 30 s while far under the aim', () => {
  const h = startSession({ steps: [search()], hrOn: true });
  assert.equal(h.runner.searching(h.session.steps[0]), true);
  h.run(180, { speed: belt(h, 2), hr: 100 });
  const sent = h.speeds();
  assert.equal(sent[0].speed, 2.5, 'from the belt, not from a plan');
  assert.ok(sent[0].at >= 45 && sent[0].at < 60, 'after the grace');
  assert.ok(sent.every((x, i) => !i || x.at - sent[i - 1].at >= 30));
  assert.ok(sent.every((x, i) => !i || Math.abs(x.speed - sent[i - 1].speed - 0.5) < 1e-9));
  assert.equal(h.session.samples.at(-1).target, sent.at(-1).speed);
});

test('flow: the search goes on rising while HR does not, up to its ceiling, past the +1.5 km/h of a planned step', () => {
  const h = startSession({ steps: [search()], hrOn: true });
  h.run(1200, { speed: belt(h, 2), hr: 100 });
  assert.equal(h.speeds().at(-1).speed, 12);
  assert.equal(h.session.hrAdjust, 10);
});

test('flow: near the aim the search is careful: +0.2 km/h, 60 s apart, not while HR climbs; above it, speed comes down', () => {
  const h = startSession({ steps: [search()], hrOn: true });
  h.run(240, { speed: belt(h, 6), hr: 135 });                // 14 under the aim (149), steady
  const near = h.speeds();
  assert.ok(near.length >= 2);
  assert.ok(near.every((x, i) => (i ? x.speed - near[i - 1].speed : x.speed - 6) < 0.21));
  assert.ok(near.every((x, i) => !i || x.at - near[i - 1].at >= 60));

  const climbing = startSession({ steps: [search()], hrOn: true });
  climbing.run(240, { speed: belt(climbing, 6), hr: (t) => 115 + t * 0.1 }); // rising 6 bpm/min, projected within 20 of the aim from ~3 min
  const late = climbing.speeds().filter((x) => x.at > 200);
  assert.equal(late.length, 0, 'no rise while HR is still climbing near the aim');

  const high = startSession({ steps: [search()], hrOn: true });
  high.run(120, { speed: belt(high, 9), hr: 165 });
  assert.ok(high.speeds().at(-1).speed < 9);
});

test('flow: the search moves on from a speed changed on the console, stops with no HR, and the α1 guard still blocks rises', () => {
  const h = startSession({ steps: [search()], hrOn: true });
  h.run(60, { speed: belt(h, 2), hr: 100 });
  live.console.targetSpeed = 5;                              // the athlete raised it on the console
  h.run(40, { speed: 5, hr: 100 });
  live.console.targetSpeed = undefined;
  assert.equal(h.speeds().at(-1).speed, 5.5);

  const noHr = startSession({ steps: [search()], hrOn: true });
  noHr.run(300, { speed: 2, hr: null });
  assert.equal(noHr.speeds().length, 0);

  const guard = startSession({ steps: [search({ zone: 2 })], hrOn: true });
  guard.run(180, { speed: belt(guard, 6), hr: 120, alpha1: 1 });
  const n = guard.speeds().length;
  guard.run(300, { speed: belt(guard, 6), hr: 120, alpha1: 0.5 });
  const after = guard.speeds().slice(n);
  const top = guard.speeds()[n - 1]?.speed;
  assert.ok(after.filter((x) => x.at > 300).every((x) => x.speed <= top), 'no rises with α1 low');
});

test('flow: after a restart the speed the search found goes again; without HR on, or with a planned speed, nothing searches', () => {
  const h = startSession({ steps: [search()], hrOn: true });
  h.run(120, { speed: belt(h, 4), hr: 100 });
  const found = h.speeds().at(-1).speed;
  h.run(5, { speed: 0, hr: 100 });
  assert.equal(h.session.state, 'paused');
  const n = h.sent.length;
  h.run(1, { speed: 2, hr: 100 });
  assert.equal(h.session.state, 'running');
  assert.equal(h.sent.slice(n).find((x) => x.speed != null).speed, found);

  const off = startSession({ steps: [search()], hrOn: false });
  off.run(300, { speed: 2, hr: 100 });
  assert.equal(off.speeds().length, 0);

  const planned = startSession({ steps: [runStep({ hr: { lo: 146, hi: 153, mode: 'target' } })], hrOn: true });
  assert.equal(planned.runner.searching(planned.session.steps[0]), false);
});

test('flow: the real treadmill simulator drives a session', async () => {
  const { getDriver } = await import('../src/devices/registry.js');
  const h = startSession({ steps: [runStep({ speedStart: 8, speedEnd: 8 })] });
  const sim = getDriver('simulated-treadmill').create({
    onData: (s) => { live.speed = s.speed; live.incline = s.incline; },
  });
  sim.running = true;          // no connect(): no timers, ticks below
  h.device.setTarget = (t) => sim.setTarget(t);
  const tickBoth = (n) => { for (let i = 0; i < n; i++) { sim._tick(1); h.device.state.updatedAt = Date.now(); h.run(1, { speed: live.speed }); } };
  sim.simulate({ belt: 'toggle' });
  tickBoth(8);
  assert.equal(h.session.state, 'running');
  assert.equal(sim.target.speed, 8);
  sim.simulate({ belt: 'toggle' });
  tickBoth(12);
  assert.equal(h.session.state, 'paused');
});

test('csv: ride samples (no incline) export', () => {
  const csv = samplesToCsv([{ elapsed: 1, distance: 8, speed: 30, power: 200, cadence: 90, hr: 120, target: 200 }]);
  // A ride: no pace, incline nor target speed; power, cadence and the target in watts at the end
  assert.match(csv.split('\n')[1], /^1,30\.00,,,,120,8\.0,,,,,,,,200,90,200,$/);
});

const Z1 = { lo: 92, hi: 134, mode: 'target' };

test('flow (2026-11-04): a Z1 step leaves speed alone while HR is in range, and only its top slows the belt', () => {
  const recovery = startSession({ steps: [runStep({ hr: Z1, zone: 1, speedStart: 6.8, speedEnd: 6.8, duration: 120 }), runStep({ duration: 60 })], hrOn: true });
  recovery.run(115, { speed: 6.8, hr: (t) => 132 - t / 10 });          // falling from the effort, in range
  assert.ok(recovery.speeds().every((s) => s.speed === 6.8), JSON.stringify(recovery.speeds()));

  const over = startSession({ steps: [runStep({ hr: Z1, zone: 1, speedStart: 6.8, speedEnd: 6.8, duration: 900 })], hrOn: true });
  over.run(100, { speed: 6.8, hr: 142 });
  assert.ok(over.speeds().at(-1).speed < 6.8, 'above the top of Z1 it comes down');
  over.run(400, { speed: 6.8, hr: 118 });
  assert.equal(over.speeds().at(-1).speed, 6.8, 'and gives it back, never above the plan');
});

test('flow: a Z1 step with no planned speed still searches for it', () => {
  const h = startSession({ steps: [runStep({ hr: Z1, zone: 1, hasTarget: false, speedStart: null, speedEnd: null, duration: 300 })], hrOn: true });
  h.run(150, { speed: 3, hr: 80 });
  assert.ok(h.session.hrAdjust > 0, 'far under the aim it searches');
});

const reps = (o = {}) => [
  runStep({ hr: Z2, zone: 2, speedStart: 8, speedEnd: 8, duration: 180, ...o }),
  runStep({ hr: Z1, zone: 1, speedStart: 6.8, speedEnd: 6.8, duration: 120, ...o }),
];
const speedAt = (h, at) => h.speeds().filter((s) => s.at <= at).at(-1).speed;

test('flow (2026-11-04): each repetition starts where the last one like it ended', () => {
  const h = startSession({ steps: [...reps(), ...reps()], hrOn: true, hrOnly: true });
  h.run(179, { speed: 8, hr: 125 });
  const ended = speedAt(h, 179);
  assert.ok(ended > 8, `HR under Z2 raised it: ${ended}`);
  h.run(120, { speed: 6.8, hr: 125 });                 // the recovery, in range: its own plan
  assert.equal(speedAt(h, 298), 6.8);
  h.run(3, { speed: ended, hr: 125 });
  assert.equal(speedAt(h, 302), ended, 'the second Z2 starts at the speed of the first');
  assert.equal(h.session.hrAdjust, Math.round((ended - 8) * 10) / 10);
});

test('flow: a Z1 repetition also carries its speed, and it can come back down or up', () => {
  const h = startSession({ steps: [...reps(), ...reps()], hrOn: true, hrOnly: true });
  h.run(180, { speed: 8, hr: 142 });
  h.run(119, { speed: 6.8, hr: 145 });                 // recovery above its top
  const ended = speedAt(h, 298);
  assert.ok(ended < 6.8, `${ended}`);
  h.run(180, { speed: 8, hr: 142 });
  h.run(3, { speed: ended, hr: 145 });
  assert.equal(speedAt(h, 482), ended);
});

test('flow: the manual change is carried too, and a different step is not touched', () => {
  const steps = [...reps(), runStep({ hr: { lo: 151, hi: 158, mode: 'target' }, zone: 3, speedStart: 9, speedEnd: 9, duration: 60 }), ...reps()];
  const h = startSession({ steps, hrOn: true, hrOnly: true });
  h.run(10, { speed: 8, hr: 141 });
  h.session.adjust = 0.5;                              // what + does
  h.runner.pushTarget();
  assert.equal(speedAt(h, 11), 8.5);
  h.run(170, { speed: 8.5, hr: 141 });
  h.run(122, { speed: 6.8, hr: 120 });
  assert.equal(h.session.adjust, 0, 'other steps keep their own plan');
  assert.equal(speedAt(h, 302), 9);
  h.run(60, { speed: 9, hr: 155 });
  assert.equal(h.session.adjust, 0.5);
  assert.equal(h.speeds().at(-1).speed, 8.5);
});

test('flow: a rise is not carried while the α1 guard is on', () => {
  const h = startSession({ steps: [...reps(), ...reps()], hrOn: true });
  h.run(100, { speed: 8, hr: 125 });
  const up = h.session.hrAdjust;
  assert.ok(up > 0);
  h.run(200, { speed: 8, hr: 125 });
  h.session.alphaGuard = true;
  h.runner.applyStep(2);
  assert.equal(h.session.hrAdjust, 0);
});

test('flow: ramps and cool-downs start from their plan, and a search starts at the speed found', () => {
  const ramp = startSession({ steps: [runStep({ hr: Z2, zone: 2, ramp: true, speedStart: 8, speedEnd: 9, duration: 120 }), runStep({ hr: Z2, zone: 2, ramp: true, speedStart: 8, speedEnd: 9, duration: 120 })], hrOn: true });
  ramp.run(121, { speed: 8.5, hr: 120 });
  assert.equal(ramp.session.hrAdjust, 0);

  const one = (lo, hi) => runStep({ hasTarget: false, speedStart: null, speedEnd: null, duration: 180, zone: 1, hr: { lo, hi, mode: 'target' } });
  const h = startSession({ steps: [one(135, 150), one(92, 134), one(135, 150)], hrOn: true, hrOnly: true });
  h.run(179, { speed: 5, hr: 90 });
  const found = h.session.target;
  assert.ok(found > 5);
  h.run(180, { speed: found, hr: 125 });
  h.run(3, { speed: found, hr: 125 });
  assert.equal(h.session.target, found);
  assert.equal(h.sent.filter((x) => x.speed != null).at(-1).speed, found);
});

test('flow (#50): HR lost holds the target, tells after 10 s, goes back to the plan after 60 s, and waits its grace when it returns', () => {
  const cues = [];
  const off = runner.events.on('cue', (c) => cues.push(c.state ?? c.kind));
  const h = startSession({ steps: [runStep({ hr: Z2, speedStart: 8, speedEnd: 8, duration: 900 })], hrOn: true, hrOnly: true });
  h.run(130, { speed: 8, hr: 125 });
  const up = h.session.hrAdjust;
  assert.ok(up > 0);
  const moves = h.speeds().length;
  h.run(9, { speed: 8, hr: null });
  assert.equal(h.session.hrLostTold, false);
  h.run(3, { speed: 8, hr: null });
  assert.equal(h.session.hrLostTold, true);
  assert.ok(cues.includes('hr-lost'));
  assert.equal(h.session.hrAdjust, up, 'held');
  assert.equal(h.speeds().length, moves);
  h.run(50, { speed: 8, hr: null });
  assert.equal(h.session.hrAdjust, 0);
  assert.equal(h.speeds().at(-1).speed, 8, 'the plan');
  assert.ok(cues.includes('hr-plan'));
  const afterPlan = h.speeds().length;
  h.run(40, { speed: 8, hr: 125 });
  assert.ok(cues.includes('hr-back'));
  assert.equal(h.speeds().length, afterPlan, 'nothing during the grace');
  h.run(100, { speed: 8, hr: 125 });
  assert.ok(h.speeds().length > afterPlan, 'then control resumes');
  off?.();
});

test('flow (#50): no alarm for a session that never had HR, and a step that lost HR teaches nothing', () => {
  const none = startSession({ steps: [runStep({ hr: Z2 })], hrOn: true });
  none.run(100, { hr: null });
  assert.equal(none.session.hrLostAt, null);

  const h = startSession({ steps: [...reps(), ...reps()], hrOn: true, hrOnly: true });
  h.run(100, { speed: 8, hr: 125 });
  const up = h.session.hrAdjust;
  assert.ok(up > 0);
  h.run(20, { speed: 8, hr: null });
  h.run(60, { speed: 8, hr: 125 });
  h.run(122, { speed: 6.8, hr: 125 });
  assert.equal(h.session.stepIdx, 2);
  assert.equal(h.session.hrAdjust, 0, 'the plan again');
});

test('hrNow: a strap with RR must be sending good beats; other sources are believed', () => {
  const save = { ...live };
  const saveRr = { ...rrState };
  const now = 1_000_000;
  const beats = (rr) => rr.map((v, i) => ({ t: now - 8000 + i * 500, rr: v }));
  live.hr = 140;
  live.hrSource = 'console';
  assert.equal(hrNow(now), 140);
  live.hrSource = 'strap';
  Object.assign(rrState, { lastAt: 0, beats: [], contact: undefined });
  assert.equal(hrNow(now), 140, 'a sensor without RR');
  Object.assign(rrState, { lastAt: now - 1000, beats: beats(Array(12).fill(450)) });
  assert.equal(hrNow(now), 140);
  rrState.lastAt = now - 6000;
  assert.equal(hrNow(now), null, 'RR went silent');
  Object.assign(rrState, { lastAt: now - 1000, beats: beats([236, 478, 249, 2102, 1012, 245, 244, 448, 307, 1556]) });
  assert.equal(hrNow(now), null, 'junk RR');
  Object.assign(rrState, { beats: beats(Array(12).fill(450)), contact: false });
  assert.equal(hrNow(now), null, 'the strap says no contact');
  Object.assign(live, save);
  Object.assign(rrState, saveRr);
  rrState.contact = undefined;
});

const hrSpeedStep = (o = {}) => runStep({ duration: 1200, speedStart: 8, speedEnd: 8, zone: 2, hr: { lo: 135, hi: 150, mode: 'target' }, ...o });

/** Seconds on a treadmill whose console and belt follow what was last asked, from `speed` on. */
function onConsole(h, seconds, speed, hr) {
  let shown = speed;
  let sends = h.speeds().length;
  for (let i = 0; i < seconds; i += 1) {
    if (h.speeds().length > sends) { sends = h.speeds().length; shown = h.speeds().at(-1).speed; }
    live.console.targetSpeed = shown;
    h.run(1, { speed: shown, hr });
  }
  live.console.targetSpeed = undefined;
}

test('flow: an HR move after a console change starts from that speed, not from the plan (#60)', () => {
  const h = startSession({ steps: [hrSpeedStep()], hrOn: true });
  h.run(120, { speed: 8, hr: 142 });
  const before = h.speeds().length;
  onConsole(h, 150, 3.2, 120);                            // lowered on the console, HR low
  assert.deepEqual(h.speeds().slice(before).map((x) => x.speed).slice(0, 2), [3.4, 3.6]);
  assert.equal(h.session.adjust, -4.8);
});

test('flow: a ramp keeps a console change', () => {
  const h = startSession({ steps: [runStep({ duration: 600, ramp: true, speedStart: 6, speedEnd: 8 })] });
  h.run(60, { speed: 6.2 });
  onConsole(h, 60, 4);
  const last = h.speeds().at(-1).speed;
  assert.ok(last >= 4.1 && last <= 4.3, `the ramp goes on from the console's 4: ${last}`);
});

test('flow: a command not yet shown on the console is not taken for a change, and a restart goes back to the target', () => {
  const steps = [hrSpeedStep({ duration: 60 }), runStep({ duration: 600, speedStart: 6, speedEnd: 6, ramp: true })];
  const shown = startSession({ steps });
  shown.run(59, { speed: 8 });
  live.console.targetSpeed = 8;                           // the console still shows the last step's speed
  shown.run(2, { speed: 8 });
  live.console.targetSpeed = undefined;
  assert.equal(shown.session.adjust, 0);

  const h = startSession({ steps: [hrSpeedStep()] });
  h.run(60, { speed: 8 });
  h.run(5, { speed: 0 });                                 // paused on the console
  live.console.targetSpeed = 1.5;                         // and started again: the belt reports its own low speed
  h.run(5, { speed: 1.5 });
  live.console.targetSpeed = undefined;
  assert.equal(h.speeds().at(-1).speed, 8);
  assert.equal(h.session.adjust, 0);
});

test('flow: a cool-down starts from a speed lowered on the console', () => {
  const steps = [hrSpeedStep({ duration: 120 }), runStep({ label: 'Cool', duration: 300, cooldown: true, ramp: true, speedStart: 7, speedEnd: 6, hr: null })];
  const h = startSession({ steps, hrOn: true });
  h.run(60, { speed: 8, hr: 142 });
  live.console.targetSpeed = 3.2;
  h.run(65, { speed: 3.2, hr: 142 });
  live.console.targetSpeed = undefined;
  assert.ok(h.speeds().at(-1).speed <= 3.2, `the cool-down asks ${h.speeds().at(-1).speed}`);
});

test('flow: the next-step cue announces where a repetition really starts, not the plan', () => {
  const z2 = () => runStep({ duration: 180, speedStart: 8, speedEnd: 8, zone: 2, hr: { lo: 135, hi: 150, mode: 'target' } });
  const rest = () => runStep({ label: 'Rest', duration: 60, speedStart: 6, speedEnd: 6, zone: 1 });
  const h = startSession({ steps: [z2(), rest(), z2()], hrOn: true });
  const cues = [];
  runner.events.on('cue', (c) => { if (c.kind === 'next') cues.push(c); });
  h.run(175, { speed: 8, hr: 170 });                      // HR high: the first rep ends under the plan
  const ended = h.session.hrAdjust;
  assert.ok(ended < 0);
  h.run(65, { speed: 6, hr: 120 });
  assert.equal(cues.length, 2);
  assert.equal(cues[0].offset, 0, 'the rest has nothing carried');
  assert.equal(cues[1].offset, ended, 'the second rep starts where the first ended');
});

test('flow: a walk changed by hand carries to the next walk, with no HR control', () => {
  const walk = () => runStep({ label: 'Walk', walk: true, duration: 60, speedStart: 3, speedEnd: 3, zone: 1 });
  const work = () => runStep({ duration: 60, speedStart: 8, speedEnd: 8 });
  const h = startSession({ steps: [walk(), work(), walk(), work()] });
  h.run(10, { speed: 3 });
  h.session.adjust = 1.5;                                 // the + button
  runner.pushTarget();
  h.run(55, { speed: 4.5 });
  assert.equal(h.speeds().at(-1).speed, 8, 'the work step keeps its plan');
  h.run(60, { speed: 8 });
  assert.equal(h.speeds().at(-1).speed, 4.5, 'the next walk starts where the last one ended');
});

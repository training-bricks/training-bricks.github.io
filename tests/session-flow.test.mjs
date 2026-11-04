// Whole sessions in Node with a fake clock: steps, stale data, and the HR
// control rules tuned in #10 (spacing, limits, no rise while climbing, α1 guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import { startSession, runStep } from './session/harness.mjs';
import { parseSessionCsv, replay } from './session/replay.mjs';
import { samplesToCsv } from '../src/export/csv.js';
import { live } from '../src/session/live.js';

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
  for (const [dip, rises] of [[8, 0], [15, 1]]) {
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

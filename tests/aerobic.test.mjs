// Steady aerobic runs (#4): Pa:HR decoupling, HR at VT1 from α1, the run history
import test from 'node:test';
import assert from 'node:assert/strict';
import { aerobicSummary, decoupling, isAerobicRun, steadyPart, vt1FromRun, vt1Trend } from '../src/physiology/aerobic.js';
import { addRun, loadRuns, decouplingLevel, runText, RUNS_KEPT } from '../src/session/run-history.js';

const STEPS = [{ warmup: true, zone: 1 }, { zone: 2 }, { cooldown: true, zone: 1 }];

/**
 * A synthetic 45 min run shaped like the 2026-10-30 one: 10 min warm-up with
 * HR 110 → 132, 30 min at 133 bpm whose speed drops from 8.2 to 7.6 km/h
 * halfway through the steady part, 5 min cool-down. α1 follows the mean HR
 * of its 2 min window (as the real one does) with VT1 at `vt1` bpm (0.03 per
 * bpm), with a small deterministic wobble.
 */
function run({ vt1 = 125, alpha = true, warmupHr = true, mainMin = 30 } = {}) {
  const main = mainMin * 60;
  const mid = 600 + 300 + (main - 300) / 2;     // the middle of the steady part (after its first 5 min)
  const n = 600 + main + 300;
  const stepOf = (t) => (t < 600 ? 1 : t < 600 + main ? 2 : 3);
  const hrs = Array.from({ length: n }, (_, t) => Math.round(stepOf(t) === 1 ? (warmupHr ? 110 + (22 * t) / 600 : 133) : stepOf(t) === 2 ? 133 : 128));
  let distance = 0;
  return hrs.map((hr, t) => {
    const step = stepOf(t);
    const speed = step === 1 ? 6.8 + t / 600 : step === 2 ? (t < mid ? 8.2 : 7.6) : 7;
    distance += speed / 3.6;
    const win = hrs.slice(Math.max(0, t - 119), t + 1);
    const a1 = 0.75 + (vt1 - win.reduce((a, h) => a + h, 0) / win.length) * 0.03 + 0.04 * Math.sin(t / 7);
    return { elapsed: t, speed, incline: 2, hr, alpha1: alpha && t >= 120 ? Math.round(a1 * 100) / 100 : null, distance, step };
  });
}

test('aerobic: Pa:HR over the steady part (no warm-up, cool-down nor its first 5 min)', () => {
  const steady = steadyPart(run(), STEPS);
  assert.equal(steady[0].elapsed, 900);
  assert.equal(steady.at(-1).elapsed, 2399);
  const d = decoupling(steady);
  assert.equal(d.pct, 7.3);                     // 8.2 → 7.6 km/h at the same HR
  assert.deepEqual([d.first.hr, d.second.hr], [133, 133]);
  assert.equal(d.minutes, 25);
  assert.equal(decoupling(steadyPart(run({ mainMin: 20 }), STEPS)), null, 'under 20 min of steady part: nothing');
});

test('aerobic: HR at VT1 from α1, with the warm-up giving the line its slope', () => {
  for (const vt1 of [118, 122, 126]) { // α1 above 1.1 is left out, as in the threshold test
    const r = vt1FromRun(run({ vt1 }));
    assert.ok(Math.abs(r.hr - vt1) <= 1, `VT1 ${vt1}: got ${r.hr}`);
    assert.ok(r.r2 >= 0.9);
  }
  assert.equal(vt1FromRun(run({ alpha: false })), null, 'no chest strap');
  assert.equal(vt1FromRun(run({ warmupHr: false })), null, 'HR never moved: no line');
});

test('aerobic: which runs count', () => {
  assert.ok(isAerobicRun(STEPS));
  assert.ok(isAerobicRun([]), 'a free session');
  assert.ok(!isAerobicRun([{ zone: 2 }, { zone: 4 }]), 'intervals');
  assert.ok(!isAerobicRun([{ warmup: true }, { test: true, zone: 2 }]), 'the threshold test');
  assert.equal(aerobicSummary(run(), [{ zone: 4 }, { zone: 4 }, { zone: 4 }]), null);
});

test('aerobic: the summary of a run, and α1 alone when there is no line', () => {
  const s = aerobicSummary(run(), STEPS);
  assert.equal(s.decoupling.pct, 7.3);
  assert.ok(Math.abs(s.vt1.hr - 125) <= 1);
  assert.equal(s.alpha.hr, 133);
  assert.ok(s.alpha.median < 0.75 && s.alpha.underVt1 > 90);
  assert.equal(s.minutes, 45);
  const flat = aerobicSummary(run({ warmupHr: false }), STEPS);
  assert.equal(flat.vt1, null);
  assert.ok(flat.alpha);
  assert.equal(aerobicSummary(run({ alpha: false }), STEPS).alpha, null);
});

test('aerobic: VT1 trend is the median of the last runs with one', () => {
  const runs = [{ vt1: { hr: 126 } }, { vt1: null }, { vt1: { hr: 131 } }, { vt1: { hr: 128 } }];
  assert.deepEqual(vt1Trend(runs), { hr: 128, runs: 3 });
  assert.equal(vt1Trend([{ vt1: { hr: 126 } }]), null, 'one run is not a trend');
});

test('run history: newest first, at most RUNS_KEPT, and how a run reads', () => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  try {
    for (let i = 0; i < RUNS_KEPT + 2; i++) addRun({ decoupling: { pct: i }, vt1: null }, new Date(Date.UTC(2026, 0, 1, 0, i)));
    const runs = loadRuns();
    assert.equal(runs.length, RUNS_KEPT);
    assert.equal(runs[0].decoupling.pct, RUNS_KEPT + 1);
  } finally {
    delete globalThis.localStorage;
  }
  assert.deepEqual([4.9, 5, 10, 10.1].map(decouplingLevel), ['good', 'fair', 'fair', 'high']);
  assert.equal(runText({ decoupling: { pct: 7.8 }, vt1: { hr: 126 } }), 'Pa:HR 7.8 % (moderate) · VT1 ≈ 126 bpm (α1)');
  assert.equal(runText({ decoupling: { pct: 3.2 }, vt1: null, alpha: { median: 0.82, hr: 128 } }), 'Pa:HR 3.2 % (aerobic base held) · α1 0.82 at 128 bpm');
  assert.equal(runText({ decoupling: { pct: 12 }, vt1: null, alpha: null }), 'Pa:HR 12.0 % (pace too much today) · no α1 (needs a chest strap)');
});

test('flow (#4): a steady aerobic run saves its metrics at the end; intervals do not', async () => {
  const { startSession, runStep } = await import('./session/harness.mjs');
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  try {
    const steps = [
      runStep({ label: 'Warm-up', warmup: true, zone: 1, duration: 600, speedStart: 7, speedEnd: 7 }),
      runStep({ label: 'Z2', zone: 2, duration: 1800, speedStart: 8, speedEnd: 8 }),
      runStep({ label: 'Cool-down', cooldown: true, zone: 1, duration: 300, speedStart: 7, speedEnd: 7 }),
    ];
    const h = startSession({ steps });
    const notes = [];
    h.runner.events.on('note', ({ text }) => notes.push(text));
    // HR drifts up 1 bpm a minute in the main step at the same speed: ≈ 8 % decoupling
    h.run(2720, { speed: (t) => (t < 600 ? 7 : t < 2400 ? 8 : 7), hr: (t) => Math.round(t < 600 ? 110 + t / 30 : 130 + (t - 600) / 60) });
    assert.equal(h.session.state, 'done');
    const runs = loadRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].name, 'Test');
    assert.ok(runs[0].decoupling.pct > 5, `${runs[0].decoupling.pct}`);
    assert.equal(runs[0].vt1, null, 'no chest strap');
    assert.match(notes.join(' '), /Aerobic run: Pa:HR/);

    const intervals = startSession({ steps: [runStep({ zone: 4, duration: 1800 })] });
    intervals.run(1810, { hr: 160 });
    assert.equal(loadRuns().length, 1, 'not an aerobic run');
  } finally {
    delete globalThis.localStorage;
  }
});

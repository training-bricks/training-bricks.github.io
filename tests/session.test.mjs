// Speed and incline adjustment by HR
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hrDecision, hrSlope, alphaVetoApplies, alphaDropApplies, AEROBIC_AIM } from '../src/session/hr-control.js';

test('HR control: aims at the middle, looks ahead, scales the correction', () => {
  const z2 = { mode: 'target', lo: 135, hi: 160, hrAdjust: 0 };
  // Steady at 158 with Z2 135–160: above the middle (147.5), so it slows down by the max step
  assert.deepEqual(hrDecision({ ...z2, hr: 158, slope: 0 }).delta, -0.5);
  // On target, nothing
  assert.equal(hrDecision({ ...z2, hr: 148, slope: 0 }).delta, 0);
  // Still on target but climbing 0.2 bpm/s → projected 154 in 30 s: slow down a little already
  assert.equal(hrDecision({ ...z2, hr: 148, slope: 0.2 }).delta, -0.4);
  // Below the range: speed up
  assert.ok(hrDecision({ ...z2, hr: 138, slope: 0 }).delta > 0);
});

test('HR control: pace steps cap HR ahead of time and give the speed back', () => {
  const cap = { mode: 'cap', lo: 135, hi: 160 };
  assert.equal(hrDecision({ ...cap, hr: 155, slope: 0, hrAdjust: 0 }).delta, 0);
  assert.ok(hrDecision({ ...cap, hr: 157, slope: 0.2, hrAdjust: 0 }).delta < 0);   // heading to 163
  assert.equal(hrDecision({ ...cap, hr: 150, slope: 0, hrAdjust: -0.4 }).delta, 0.2);  // gives back at most MAX_RISE (#10)
  assert.equal(hrDecision({ ...cap, hr: 150, slope: 0.1, hrAdjust: -0.4 }).delta, 0); // still rising
});

test('HR control: α1 below VT1 slows aerobic steps even with HR in range', () => {
  const p = { mode: 'target', lo: 135, hi: 160, hr: 147, slope: 0, hrAdjust: 0 };
  const low = { alphaVeto: true, alphaDrop: true };
  assert.equal(hrDecision({ ...p }).delta, 0);
  assert.deepEqual(hrDecision({ ...p, ...low }), { delta: -0.2, reason: 'α1 below 0.75 with HR 147', alpha: true });
  assert.equal(hrDecision({ ...p, hr: 130, ...low }).delta, -0.2);       // never speeds up
  assert.equal(hrDecision({ ...p, hr: 160, ...low }).delta, -0.5);       // HR correction is bigger
  assert.equal(hrDecision({ ...p, hr: 160, ...low }).alpha, false);
  assert.equal(hrSlope([1, 2, 3, 4, 5, 6].map((i) => ({ elapsed: i, hr: 140 + i }))), 1);
  assert.equal(hrSlope([{ elapsed: 1, hr: 140 }]), 0);
});

// #10: cases from the Z2 HR run of 2026-10-28 (brickwise-2026-10-28T1414.csv).
// Z2 135–150, HR-target step; before the fix every one of them asked for the deltas noted.
const z2run = { mode: 'target', lo: 135, hi: 150, hrAdjust: 0, aim: AEROBIC_AIM };

test('#10 HR control: no rise while HR is still climbing at the start of the step', () => {
  // 8:56, HR 127 rising ~0.25 bpm/s: was +0.5 (then +0.5, +0.3, +0.2 up to 9.5 km/h, α1 0.28)
  assert.equal(hrDecision({ ...z2run, hr: 127, slope: 0.25 }).delta, 0);
  // Once HR settles below the aim, it rises, by at most 0.2
  assert.equal(hrDecision({ ...z2run, hr: 127, slope: 0 }).delta, 0.2);
});

test('#10 HR control: a short dip does not ask for a big rise', () => {
  // 38:19, HR 137 after 143 (slope ≈ −0.3): projected 128, was +0.5, then −0.5 40 s later
  assert.equal(hrDecision({ ...z2run, hr: 137, slope: -0.3 }).delta, 0.1);
  // 32:41, HR 140 dipping: on target now (aim 141), was +0.5
  assert.equal(hrDecision({ ...z2run, hr: 140, slope: -0.3 }).delta, 0);
  // Drops are unchanged: 17:14, HR 147 climbing
  assert.equal(hrDecision({ ...z2run, hr: 147, slope: 0.1 }).delta, -0.5);
});

test('#10 HR control: aerobic HR targets aim at 40 % of the range', () => {
  // Z2 135–150 aims at 141 (was 142.5, right at this athlete's VT1)
  assert.equal(hrDecision({ ...z2run, hr: 143, slope: 0 }).delta, 0);
  assert.equal(hrDecision({ ...z2run, hr: 145, slope: 0 }).delta, -0.1);
  assert.equal(hrDecision({ ...z2run, aim: 0.5, hr: 145, slope: 0 }).delta, 0);
});

test('#10 α1 guard: the drop is not in the warm-up nor with HR in Z1', () => {
  // 3:14–6:01, warm-up at 114–117 bpm with α1 0.52–0.70: slowed the warm-up four times
  assert.equal(alphaDropApplies({ zone: 1, warmup: true, hr: 116, z1Top: 134 }), false);
  assert.equal(alphaDropApplies({ zone: 2, warmup: false, hr: 130, z1Top: 134 }), false);
  // 11:00, Z2 step at 138 bpm with α1 0.32: the guard acts
  assert.equal(alphaDropApplies({ zone: 2, warmup: false, hr: 138, z1Top: 134 }), true);
  assert.equal(alphaDropApplies({ zone: 3, warmup: false, hr: 150, z1Top: 134 }), false);
  assert.equal(alphaDropApplies({ zone: 2, cooldown: true, hr: 138, z1Top: 134 }), false);
});

test('#10 α1 guard: the veto (no rise) also holds with HR in Z1, but not in the warm-up or cool-down', () => {
  // 2026-10-30: HR 132–133 (Z1) with α1 0.4–0.6, the Z2 target (aim ≈ 140) rose +0.2 fifteen times
  assert.equal(alphaVetoApplies({ zone: 2, warmup: false, hr: 132 }), true);
  assert.equal(alphaVetoApplies({ zone: 2, warmup: true }), false);
  assert.equal(alphaVetoApplies({ zone: 2, cooldown: true }), false);
  assert.equal(alphaVetoApplies({ zone: 3 }), false);
  const z2 = { mode: 'target', lo: 135, hi: 148, hr: 132, slope: 0, hrAdjust: 0, aim: AEROBIC_AIM };
  assert.equal(hrDecision(z2).delta, 0.2);                                          // without α1: HR asks for more
  assert.equal(hrDecision({ ...z2, alphaVeto: true }).delta, 0);                    // α1 says no
  const cap = { mode: 'cap', lo: 135, hi: 160, hr: 150, slope: 0, hrAdjust: -0.4 };
  assert.equal(hrDecision({ ...cap, alphaVeto: true }).delta, 0);                   // nor gives back
  assert.equal(hrDecision({ ...cap, giveBack: false }).delta, 0);                   // the cool-down does not give back
});

test('HR control (#8): the same decision in watts with the POWER actuator', async () => {
  const { POWER } = await import('../src/session/hr-control.js');
  const z2 = { mode: 'target', lo: 131, hi: 145, hrAdjust: 0, aim: AEROBIC_AIM };   // aim 136.6
  assert.equal(hrDecision({ ...z2, hr: 150, slope: 0 }, POWER).delta, -15);      // far over: the largest step
  assert.equal(hrDecision({ ...z2, hr: 142, slope: 0 }, POWER).delta, -6);       // 2.4 bpm past aim 136.6 + 3 × 2.5 W
  assert.equal(hrDecision({ ...z2, hr: 139, slope: 0 }, POWER).delta, 0);        // on target (136.6 ± 3)
  assert.equal(hrDecision({ ...z2, hr: 140, slope: 0 }, POWER).delta, -3);       // just past it: the smallest step
  assert.equal(hrDecision({ ...z2, hr: 120, slope: 0 }, POWER).delta, 5);        // rises at most 5 W
  assert.equal(hrDecision({ ...z2, hr: 120, slope: 0.1 }, POWER).delta, 0);      // not while HR climbs
  assert.deepEqual(hrDecision({ ...z2, hr: 138, slope: 0, alphaVeto: true, alphaDrop: true }, POWER), { delta: -5, reason: 'α1 below 0.75 with HR 138', alpha: true });
  assert.ok(Number.isInteger(hrDecision({ ...z2, hr: 143.3, slope: 0 }, POWER).delta), 'whole watts');
});

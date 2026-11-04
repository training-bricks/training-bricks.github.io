// HR zones against the VT1 estimated by α1 (#41)
import test from 'node:test';
import assert from 'node:assert/strict';
import { zoneMismatch, latestVt1, isDismissed, dismissal } from '../src/session/zone-check.js';

const ride = (hr, date = '2026-11-01') => ({ sport: 'ride', date, vt1: { hr } });
const run = (hr, date = '2026-11-01') => ({ date, vt1: { hr } }); // old entries carry no sport
const cycling = [{ hi: 129 }, { hi: 145 }];
const running = [{ hi: 134 }, { hi: 150 }];

test('zone check: a ride history under the start of Z2 warns; the real case of 2026-11-01', () => {
  const m = zoneMismatch({ runs: [ride(120), ride(121), ride(119)], sport: 'ride', hrZones: cycling });
  assert.deepEqual(m, { sport: 'ride', vt1: 120, z1Top: 129, z2Start: 130, source: 'trend' });
});

test('zone check: no warning without a mismatch, at exactly 5 bpm, or above it', () => {
  assert.equal(zoneMismatch({ runs: [ride(127), ride(128)], sport: 'ride', hrZones: cycling }), null);
  assert.equal(zoneMismatch({ runs: [ride(124), ride(124)], sport: 'ride', hrZones: cycling }), null, '5 bpm is not more than 5');
  assert.ok(zoneMismatch({ runs: [ride(123), ride(123)], sport: 'ride', hrZones: cycling }), '6 bpm under');
  assert.ok(zoneMismatch({ runs: [ride(136), ride(136)], sport: 'ride', hrZones: cycling }), 'and above');
});

test('zone check: one session is not a trend, and each sport has its own', () => {
  assert.equal(zoneMismatch({ runs: [ride(110)], sport: 'ride', hrZones: cycling }), null);
  const runs = [ride(110), ride(110), run(133), run(135)];
  assert.equal(zoneMismatch({ runs, sport: 'run', hrZones: running }), null);
  assert.equal(zoneMismatch({ runs, sport: 'ride', hrZones: cycling }).vt1, 110);
});

test('zone check: the last test counts on its own, and the newer of test and trend wins', () => {
  const test1 = { sport: 'ride', date: '2026-11-03', vt1: { hr: 115 } };
  assert.equal(zoneMismatch({ tests: [test1], sport: 'ride', hrZones: cycling }).source, 'test');
  const runs = [ride(128, '2026-11-01'), ride(128, '2026-10-30')];
  assert.deepEqual(latestVt1(runs, [test1], 'ride'), { hr: 115, source: 'test' });
  const old = { ...test1, date: '2026-10-01' };
  assert.deepEqual(latestVt1(runs, [old], 'ride'), { hr: 128, source: 'trend' });
  assert.deepEqual(latestVt1([], [{ date: '2026-10-01', vt1: { hr: 140 } }], 'run'), { hr: 140, source: 'test' }, 'a test with no sport is a run');
  assert.equal(latestVt1([], [test1], 'run'), null);
});

test('zone check: without zones or data there is nothing to compare', () => {
  assert.equal(zoneMismatch({ runs: [ride(120), ride(120)], sport: 'ride', hrZones: [] }), null);
  assert.equal(zoneMismatch({ runs: [ride(120), ride(120)], sport: 'ride', hrZones: undefined }), null);
  assert.equal(zoneMismatch({ sport: 'run', hrZones: running }), null);
});

test('zone check: dismissed per value: it comes back when VT1 or the zones change, per sport', () => {
  const m = { sport: 'ride', vt1: 120, z1Top: 129 };
  const stored = dismissal(m, { run: '133/140' });
  assert.deepEqual(stored, { run: '133/140', ride: '120/129' });
  assert.equal(isDismissed(m, stored), true);
  assert.equal(isDismissed({ ...m, vt1: 118 }, stored), false);
  assert.equal(isDismissed({ ...m, z1Top: 125 }, stored), false);
  assert.equal(isDismissed({ ...m, sport: 'run' }, {}), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { state, on, setProfile, setSelection, setDevice, setAthlete, setWellness, zonesForEvent, zonesFor } from '../src/state.js';

const ride = { hr: [{ z: 1, lo: 0, hi: 120 }], power: [{ z: 1, lo: 0, hi: 104 }], ftp: 190, lthr: 162, maxHr: 185 };
const run = { hr: [{ z: 1, lo: 0, hi: 134 }], pace: [{ z: 1, lo: 0, hi: 7.5 }], lthr: 168, ride };

test('state: zonesForEvent picks running or cycling zones', () => {
  assert.equal(zonesForEvent(run, { sport: 'run' }), run);
  assert.equal(zonesForEvent(run, null), run);
  assert.deepEqual(zonesForEvent(run, { sport: 'ride' }), { hr: ride.hr, pace: [], power: ride.power, ftp: 190, lthr: 162, maxHr: 185 });
  assert.equal(zonesForEvent({ ...run, ride: null }, { sport: 'ride' }), null);
  assert.equal(zonesForEvent(null, { sport: 'run' }), null);
});

test('state: setProfile computes the zones and notifies', () => {
  const seen = [];
  on('profile', (p) => seen.push(p));
  setProfile({ thresholdKmh: 9.73, lthr: 168, maxHr: 185, pacePct: [78, 88, 94, 100, 103, 111, 999], hrPct: [80, 89, 94, 100, 102, 106, 999] });
  assert.equal(state.zones.lthr, 168);
  assert.ok(state.zones.hr.length && state.zones.pace.length);
  assert.equal(zonesFor({ sport: 'run' }), state.zones);
  assert.equal(seen.length, 1);
  setProfile(null);
  assert.equal(state.zones, null);
});

test('state: selection and devices notify with their value', () => {
  const seen = [];
  on('selection', (s) => seen.push(['selection', s?.key ?? null]));
  on('device', (d) => seen.push(['device', d.kind, d.device?.id ?? null]));
  setSelection({ key: 'l:z2-45-1', event: {}, steps: [] });
  setDevice('treadmill', { id: 'sim' });
  setSelection(null);
  assert.deepEqual(seen, [['selection', 'l:z2-45-1'], ['device', 'treadmill', 'sim'], ['selection', null]]);
  assert.equal(state.devices.treadmill.id, 'sim');
  assert.equal(state.selection, null);
});

test('state: planned workouts, library and workout options notify', async () => {
  const { setPlanned, setLibrary, setWorkoutOptions } = await import('../src/state.js');
  const seen = [];
  on('planned', (l) => seen.push(['planned', l.length]));
  on('library', (l) => seen.push(['library', l.entries.length, l.loaded]));
  on('options', (o) => seen.push(['options', o.position, o.hrAdjust]));
  assert.equal(state.library.loaded, false);
  setPlanned([{ name: 'a' }]);
  setLibrary([{ id: 'x' }, { id: 'y' }]);
  setWorkoutOptions({ position: 'high' });
  assert.deepEqual(seen, [['planned', 1], ['library', 2, true], ['options', 'high', true]]);
  assert.equal(state.workoutOptions.defaultIncline, 1); // the rest is kept
});

test('state: the resting HR sets the bottom of Z1, the latest wellness over the account', () => {
  let redone = 0;
  const off = on('profile', () => { redone += 1; });
  setProfile({ thresholdKmh: 9.73, lthr: 168, maxHr: 185, pacePct: [78, 88, 94, 100, 103, 111, 999], hrPct: [80, 89, 94, 100, 102, 106, 999] });
  const from = state.zones.hr[1].lo;
  assert.equal(state.zones.hr[0].lo, Math.round((60 + from) / 2));
  setAthlete({ restingHr: 50 });
  assert.equal(state.zones.hr[0].lo, Math.round((50 + from) / 2));
  setWellness({ restingHr: { value: 44, date: '2026-11-04' } });
  assert.equal(state.zones.hr[0].lo, Math.round((44 + from) / 2));
  assert.equal(redone, 3);
  setWellness({ restingHr: { value: 44, date: '2026-11-05' } });
  assert.equal(redone, 3, 'the same resting HR redoes nothing');
  setWellness(null); setAthlete(null); setProfile(null);
  off?.();
});

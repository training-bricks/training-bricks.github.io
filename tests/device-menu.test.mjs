import test from 'node:test';
import assert from 'node:assert/strict';
import { connectPlan, menuEntries } from '../src/ui/device-menu.js';

const labels = (entries) => entries.map((e) => e.label);

test('device menu: treadmill, with and without debug', () => {
  // Two real treadmill drivers (EXP 5i and FTMS): one chooser for both
  assert.equal(connectPlan('treadmill').mode, 'chooser');
  assert.deepEqual(connectPlan('treadmill').drivers.map((d) => d.id), ['nordictrack-exp5i', 'ftms-treadmill']);
  assert.deepEqual(labels(menuEntries('treadmill')), ['Connect treadmill']);
  assert.deepEqual(labels(menuEntries('treadmill', { debug: true })), ['Connect treadmill', 'Simulator: Simulated treadmill']);
  assert.deepEqual(labels(menuEntries('treadmill', { last: { driver: 'nordictrack-exp5i', name: 'I_TL1234' } })), ['Connect treadmill (last: I_TL1234)']);
});

test('device menu: the FTMS trainer driver connects through its own chooser', () => {
  assert.equal(connectPlan('trainer').mode, 'single');
  const e = menuEntries('trainer');
  assert.deepEqual(labels(e), ['Connect smart trainer']);
  assert.equal(e[0].disabled, false);
  assert.deepEqual(labels(menuEntries('trainer', { debug: true })), ['Connect smart trainer', 'Simulator: Simulated smart trainer']);
});

test('device menu: a connected simulator offers its controls and Disconnect', () => {
  const tm = menuEntries('treadmill', { debug: true, device: { connected: true, simulate() {} } });
  assert.deepEqual(tm.map((x) => x.action), ['connect', 'simulator', 'sim-belt', 'sim-drop', 'disconnect']);
  assert.equal(tm[0].disabled, true);
  const tr = menuEntries('trainer', { debug: true, device: { connected: true, simulate() {} } });
  assert.deepEqual(tr.map((x) => x.action), ['connect', 'simulator', 'sim-pedal', 'sim-drop', 'disconnect']);
  // A real device without simulate(): just Disconnect
  assert.deepEqual(menuEntries('treadmill', { device: { connected: true } }).map((x) => x.action), ['connect', 'disconnect']);
});

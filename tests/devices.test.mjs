import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVERS, driversFor, getDriver, requestOptions, detect } from '../src/devices/registry.js';
import { connectGatt, subscribe } from '../src/devices/ble/gatt.js';
import { createWriteQueue } from '../src/devices/ble/write-queue.js';
import { checkDescriptor, checkLifecycle, checkTreadmill, checkTrainer } from './devices/contract.mjs';
import { ergRamp, Trainer } from '../src/devices/trainer/trainer.js';

test('drivers: every descriptor follows the contract, ids are unique', () => {
  for (const d of DRIVERS) checkDescriptor(d);
  assert.equal(new Set(DRIVERS.map((d) => d.id)).size, DRIVERS.length);
});

for (const d of DRIVERS.filter((x) => x.kind === 'treadmill')) {
  test(`drivers: ${d.id} treadmill interface`, () => checkTreadmill(d));
}

for (const d of DRIVERS.filter((x) => x.kind === 'trainer')) {
  test(`drivers: ${d.id} trainer interface`, () => checkTrainer(d));
}

for (const d of DRIVERS.filter((x) => x.debugOnly)) {
  test(`drivers: ${d.id} lifecycle`, () => checkLifecycle(d));
}

test('registry: simulators only with debug; lookups', () => {
  assert.deepEqual(driversFor('treadmill').map((d) => d.id), ['nordictrack-exp5i', 'ftms-treadmill']);
  assert.deepEqual(driversFor('treadmill', { debug: true }).map((d) => d.id), ['nordictrack-exp5i', 'ftms-treadmill', 'simulated-treadmill']);
  assert.deepEqual(driversFor('trainer').map((d) => d.id), ['ftms-trainer']);
  assert.deepEqual(driversFor('trainer', { debug: true }).map((d) => d.id), ['ftms-trainer', 'simulated-trainer']);
  assert.equal(getDriver('hr-strap').kind, 'hr');
  assert.equal(getDriver('nope'), null);
});

test('registry: requestDevice options and detection', () => {
  const t = requestOptions('treadmill');
  assert.ok(t.filters.some((f) => f.namePrefix === 'I_'));
  assert.ok(t.optionalServices.length >= 1);
  assert.deepEqual(requestOptions('hr'), { filters: [{ services: ['heart_rate'] }], optionalServices: ['heart_rate'] });
  assert.equal(detect('treadmill', { name: 'I_TL123' }).id, 'nordictrack-exp5i');
  assert.equal(detect('treadmill', { name: 'Horizon T202' }).id, 'ftms-treadmill'); // the generic (FTMS) driver
  assert.ok(t.filters.some((f) => f.services?.includes('fitness_machine')));
  assert.equal(detect('trainer', { name: 'KICKR' }).id, 'ftms-trainer'); // the generic (FTMS) driver
  assert.ok(requestOptions('trainer').filters.some((f) => f.services?.includes('fitness_machine')));
});

test('ble: write queue keeps order, retries, and a failure does not block the next write', async () => {
  const done = [];
  let fails = 1;
  const write = async (x) => {
    if (x === 'b' && fails-- > 0) throw new Error('busy');
    await new Promise((r) => setTimeout(r, x === 'a' ? 20 : 1));
    done.push(x);
  };
  const q = createWriteQueue(write, { retries: 2, retryDelayMs: 1 });
  await Promise.all([q('a'), q('b'), q('c')]);
  assert.deepEqual(done, ['a', 'b', 'c']);
  const always = createWriteQueue(async () => { throw new Error('gone'); }, { retries: 1, retryDelayMs: 1 });
  await assert.rejects(always('x'), /gone/);
  const q2 = createWriteQueue(async (x) => x, { retries: 0 });
  assert.equal(await q2('ok'), 'ok');
});

test('ble: connect with timeout, subscribe and unsubscribe', async () => {
  const listeners = {};
  const slow = { name: 'Slow', addEventListener: (n, f) => { listeners[n] = f; }, gatt: { connect: () => new Promise(() => {}) } };
  await assert.rejects(connectGatt(slow, { timeoutMs: 20, onDisconnect: () => {} }), /no answer from Slow/);
  assert.equal(typeof listeners.gattserverdisconnected, 'function');
  const fast = { addEventListener() {}, gatt: { connect: async () => 'server' } };
  assert.equal(await connectGatt(fast), 'server');

  const ch = {
    handlers: new Set(), notifying: false,
    addEventListener(n, f) { this.handlers.add(f); },
    removeEventListener(n, f) { this.handlers.delete(f); },
    async startNotifications() { this.notifying = true; },
    async stopNotifications() { this.notifying = false; },
  };
  const got = [];
  const stop = await subscribe(ch, (v) => got.push(v));
  for (const h of ch.handlers) h({ target: { value: 42 } });
  await stop();
  assert.deepEqual(got, [42]);
  assert.equal(ch.handlers.size, 0);
  assert.equal(ch.notifying, false);
});

test('trainer: ERG ramp spreads a power change and ends on the target', () => {
  assert.deepEqual(ergRamp(100, 200, 2.5, 500), [120, 140, 160, 180, 200]);
  assert.deepEqual(ergRamp(200, 150, 1, 500), [175, 150]);
  assert.deepEqual(ergRamp(180, 180), [180]);
  assert.deepEqual(ergRamp(null, 180), [180]); // first target: sent at once
});

test('trainer: base class clamps, ramps through the driver hook and stop cancels the ramp', async () => {
  const sent = [];
  class Fake extends Trainer {
    _sendPower(w) { sent.push(['power', w]); }
    _sendResistance(p) { sent.push(['resistance', p]); }
    _sendSimulation(p) { sent.push(['grade', p.grade]); }
    _sendStop() { sent.push(['stop']); }
  }
  const t = new Fake({}, { capabilities: { erg: true }, limits: { powerMin: 0, powerMax: 400, powerStep: 5, gradeMin: -5, gradeMax: 15 } });
  t.rampSeconds = 0.025;
  t.rampMs = 5;
  t.setTarget({ power: 100 });
  assert.deepEqual(sent, [['power', 100]]);
  t.setTarget({ power: 902 });  // clamped to 400, ramped from 100
  assert.equal(t.requested.power, 400);
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(sent.map(([, w]) => w).slice(1), [160, 220, 280, 340, 400]);
  t.setTarget({ power: 100 });
  t.stop();                     // the ramp down stops right away
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sent.slice(-2), [['power', 340], ['stop']]);
  t.setSimulation({ grade: 30 });
  assert.deepEqual(sent.at(-1), ['grade', 15]);
});

test('trainer: the simulator holds an ERG target while pedaling', async () => {
  const dev = getDriver('simulated-trainer').create({});
  await dev.connect();
  dev.simulate({ pedaling: true });
  dev.setTarget({ power: 200 });
  await new Promise((r) => setTimeout(r, 3500));
  assert.ok(Math.abs(dev.state.power - 200) < 30, `power ${dev.state.power}`);
  assert.ok(dev.state.cadence > 80);
  assert.ok(dev.state.speed > 20);
  assert.equal(dev.state.controlled, true);
  dev.disconnect();
});

test('timer: every() makes no last call once stopped while it waits', async () => {
  const { every } = await import('../src/lib/timer.js');
  let calls = 0;
  const stop = every(20, () => calls++);
  await new Promise((r) => setTimeout(r, 30));
  const before = calls;
  stop();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(calls, before);
});

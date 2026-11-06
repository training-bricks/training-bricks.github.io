// Automatic reconnection after a Bluetooth drop (#37)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createReconnector, retryDelay, STUCK_S } from '../src/devices/reconnect.js';
import { getDriver } from '../src/devices/registry.js';
import { connectGatt } from '../src/devices/ble/gatt.js';
import { startSession, runStep } from './session/harness.mjs';
import { menuEntries } from '../src/ui/device-menu.js';

/** A clock tests move by hand. */
function fakeClock() {
  let t = 0;
  let timers = [];
  return {
    now: () => t,
    setTimeout: (fn, ms) => { const timer = { fn, at: t + ms }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { timers = timers.filter((x) => x !== timer); },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        const next = timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        timers = timers.filter((x) => x !== next);
        t = next.at;
        next.fn();
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      t = end;
    },
    pending: () => timers.length,
  };
}

function setup({ fails = Infinity, retry = () => true } = {}) {
  const clock = fakeClock();
  const states = [];
  const at = [];
  const r = createReconnector({
    clock,
    shouldRetry: retry,
    onState: (s) => states.push(s),
    attempt: async () => {
      at.push(clock.now() / 1000);
      if (at.length <= fails) throw new Error('no answer');
    },
  });
  return { r, clock, states, at };
}

test('reconnect: 1, 2, 4, 8 s, then every 10 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelay), [1, 2, 4, 8, 10, 10]);
});

test('reconnect: retries with backoff until it comes back', async () => {
  const { r, clock, states, at } = setup({ fails: 4 });
  r.start();
  assert.equal(r.active, true);
  await clock.advance(60_000);
  assert.deepEqual(at, [1, 3, 7, 15, 25]);
  assert.equal(states.at(-1), 'back');
  assert.equal(r.active, false);
  assert.equal(clock.pending(), 0);
});

test('reconnect: keeps trying however long it takes, and asks for a hand once', async () => {
  const { r, clock, states, at } = setup();
  r.start();
  await clock.advance((STUCK_S - 10) * 1000);
  assert.ok(!states.includes('stuck'));
  await clock.advance(30_000);
  assert.equal(states.filter((x) => x === 'stuck').length, 1);
  const attempts = at.length;
  await clock.advance(600_000);
  assert.equal(states.filter((x) => x === 'stuck').length, 1);
  assert.equal(at.length, attempts + 60, 'one attempt every 10 s');
  assert.equal(r.active, true);
  r.stop();
  assert.equal(clock.pending(), 0);
});

test('reconnect: a stop (manual disconnect) ends it, even with an attempt in flight', async () => {
  const { r, clock, states, at } = setup();
  r.start();
  r.stop();
  await clock.advance(60_000);
  assert.deepEqual(at, []);
  assert.equal(states.at(-1), 'stopped');

  const clock2 = fakeClock();
  let release;
  const states2 = [];
  const r2 = createReconnector({ clock: clock2, onState: (s) => states2.push(s), attempt: () => new Promise((resolve) => { release = resolve; }) });
  r2.start();
  await clock2.advance(1000);
  r2.stop();
  release();
  await clock2.advance(1000);
  assert.equal(states2.at(-1), 'stopped', 'not "back"');
});

test('reconnect: only while the session needs the device', async () => {
  const idle = setup({ retry: () => false });
  idle.r.start();
  assert.equal(idle.r.active, false);
  let needed = true;
  const ended = setup({ retry: () => needed });
  ended.r.start();
  needed = false;
  await ended.clock.advance(5000);
  assert.deepEqual(ended.at, [], 'the session ended before the attempt');
  assert.equal(ended.states.at(-1), 'stopped');
});

/** A BluetoothDevice whose link can drop, with an FTMS bike behind it. */
function fakeBike() {
  const INDOOR_BIKE = 0x2ad2;
  const CONTROL = 0x2ad9;
  const writes = [];
  const listeners = new Set();
  const char = (extra = {}) => ({
    handlers: new Set(),
    addEventListener(_, f) { this.handlers.add(f); },
    removeEventListener(_, f) { this.handlers.delete(f); },
    async startNotifications() {}, async stopNotifications() {},
    ...extra,
  });
  let connects = 0;
  const device = {
    name: 'KICKR',
    addEventListener: (_, f) => listeners.add(f),
    removeEventListener: (_, f) => listeners.delete(f),
    gatt: {
      connected: false,
      async connect() {
        connects += 1;
        this.connected = true;
        const cp = char({
          async writeValueWithResponse(bytes) {
            writes.push([...bytes]);
            const value = new DataView(Uint8Array.from([0x80, bytes[0], 1]).buffer);
            for (const f of this.handlers) f({ target: { value } });
          },
        });
        const chars = { [INDOOR_BIKE]: char(), [CONTROL]: cp };
        return { getPrimaryService: async () => ({ getCharacteristic: async (u) => { if (!chars[u]) throw new Error('none'); return chars[u]; } }) };
      },
      disconnect() { this.connected = false; },
    },
    drop() {
      this.gatt.connected = false;
      for (const f of listeners) f();
    },
  };
  return { device, writes, listeners, connects: () => connects };
}

test('reconnect: an FTMS trainer connects again with the same device, no chooser, and takes control again', async () => {
  const bike = fakeBike();
  const statuses = [];
  const dev = getDriver('ftms-trainer').create({ onStatus: (s) => statuses.push(s) });
  await dev.connect({ device: bike.device });
  assert.equal(dev.connected, true);
  dev.setTarget({ power: 150 });
  bike.device.drop();
  assert.equal(dev.connected, false);
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(dev.sentPower, null, 'no ramp from before the drop');
  const control = bike.writes.filter((w) => w[0] === 0x00).length;
  await dev.connect({ device: dev.device }); // navigator.bluetooth does not exist here: a chooser would throw
  assert.equal(dev.connected, true);
  assert.equal(bike.writes.filter((w) => w[0] === 0x00).length, control + 1, 'Request Control again');
  assert.equal(bike.listeners.size, 1, 'one drop listener, not one per connection');
  const before = statuses.length;
  bike.device.drop();
  assert.equal(statuses.length, before + 1, 'the next drop is told once');
  dev._cancelRamp();
});

test('reconnect: connectGatt replaces the listener on the same device', async () => {
  const { device, listeners } = fakeBike();
  await connectGatt(device, { onDisconnect: () => {} });
  await connectGatt(device, { onDisconnect: () => {} });
  assert.equal(listeners.size, 1);
});

test('reconnect: a simulator drop reports disconnected and connects again', async () => {
  for (const id of ['simulated-treadmill', 'simulated-trainer']) {
    const statuses = [];
    const dev = getDriver(id).create({ onStatus: (s) => statuses.push(s) });
    await dev.connect();
    dev.simulate({ drop: true });
    assert.equal(statuses.at(-1), 'disconnected');
    assert.equal(dev.connected, false);
    await dev.connect();
    assert.equal(dev.connected, true);
    dev.disconnect();
  }
});

test('reconnect (runner): the target goes again only once the belt is moving', () => {
  const h = startSession({ steps: [runStep({ speedStart: 9, speedEnd: 9, duration: 600 })] });
  h.run(20);
  const sent = h.speeds().length;
  h.stale(10, { speed: 0 });
  assert.equal(h.session.state, 'paused', 'no readings: paused');
  h.runner.deviceBack('treadmill');
  h.run(5, { speed: 0 });
  assert.equal(h.speeds().length, sent, 'nothing to a stopped belt');
  assert.equal(h.session.state, 'paused');
  h.run(2, { speed: 9 });
  assert.equal(h.session.state, 'running');
  assert.equal(h.speeds().length, sent + 1);
});

test('reconnect (runner): a drop shorter than the auto-pause still gets the target again', () => {
  const h = startSession({ sport: 'ride', steps: [{ label: 'Z2', duration: 600, hasTarget: false, power: { lo: 150, hi: 150 }, zone: 2, hr: null, incline: 0 }] });
  h.run(20);
  const sent = h.powers().length;
  h.runner.deviceBack('trainer');
  h.run(1);
  assert.equal(h.session.state, 'running');
  assert.equal(h.powers().length, sent + 1);
  assert.equal(h.powers().at(-1).power, 150);
  h.runner.deviceBack('treadmill'); // not this session's device
  h.run(1);
  assert.equal(h.powers().length, sent + 1);
});

test('reconnect (runner): needsDevice is the session\'s device or the strap, while active', () => {
  const h = startSession({ sport: 'ride', steps: [{ label: 'Z2', duration: 30, hasTarget: false, power: { lo: 150, hi: 150 }, zone: 2, hr: null, incline: 0 }] });
  h.run(5);
  assert.equal(h.runner.needsDevice('trainer'), true);
  assert.equal(h.runner.needsDevice('hr'), true);
  assert.equal(h.runner.needsDevice('treadmill'), false);
  h.runner.endSession('end');
  assert.equal(h.runner.needsDevice('trainer'), false);
});

test('device menu: a simulator offers a connection drop', () => {
  const e = menuEntries('trainer', { debug: true, device: { connected: true, simulate() {} } });
  assert.ok(e.some((x) => x.action === 'sim-drop'));
});

test('reconnect: asks for a hand on time even if an attempt never answers, and that attempt counts as failed', async () => {
  const clock = fakeClock();
  const states = [];
  let tries = 0;
  const r = createReconnector({ clock, onState: (s) => states.push(s), attempt: () => { tries += 1; return new Promise(() => {}); } });
  r.start();
  await clock.advance((STUCK_S - 1) * 1000);
  assert.ok(!states.includes('stuck'));
  await clock.advance(2000);
  assert.equal(states.filter((x) => x === 'stuck').length, 1);
  await clock.advance(30_000);
  assert.ok(tries >= 2, 'a new attempt after the one that hung');
  r.stop();
  assert.equal(clock.pending(), 0);
});

test('reconnect: not asking for a hand once the session no longer needs the device', async () => {
  const clock = fakeClock();
  const states = [];
  let needed = true;
  const r = createReconnector({ clock, shouldRetry: () => needed, onState: (s) => states.push(s), attempt: () => Promise.reject(new Error('no')) });
  r.start();
  needed = false;
  await clock.advance((STUCK_S + 1) * 1000);
  assert.ok(!states.includes('stuck'));
});

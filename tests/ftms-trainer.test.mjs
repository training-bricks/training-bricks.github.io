// FTMS smart trainers (#7): Indoor Bike Data, ranges, bike targets, the driver over a fake GATT
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndoorBikeData, parsePowerRange, parseResistanceRange, parseFeatures, parseMachineStatus,
  setTargetPower, setTargetResistance, setSimulation,
} from '../src/devices/trainer/ftms/protocol.js';
import ftmsTrainer from '../src/devices/trainer/ftms/index.js';
import ftmsTreadmill from '../src/devices/treadmill/ftms/index.js';

const view = (...b) => new DataView(Uint8Array.from(b).buffer);
const le16 = (x) => [x & 0xff, (x >> 8) & 0xff];

test('ftms bike: Indoor Bike Data with speed, cadence, distance, power and HR', () => {
  // flags: speed present (bit0 = 0) | cadence (bit2) | distance (bit4) | power (bit6) | HR (bit9)
  const flags = 0x0004 | 0x0010 | 0x0040 | 0x0200;
  const d = parseIndoorBikeData(view(...le16(flags), ...le16(3150), ...le16(181), 0x10, 0x27, 0x00, ...le16(215), 142));
  assert.deepEqual(d, { speed: 31.5, cadence: 90.5, distance: 10000, power: 215, hr: 142 });
});

test('ftms bike: every field, in spec order', () => {
  const flags = 0x0001 | 0x0002 | 0x0004 | 0x0008 | 0x0010 | 0x0020 | 0x0040 | 0x0080 | 0x0100 | 0x0200 | 0x0400 | 0x0800 | 0x1000;
  const d = parseIndoorBikeData(view(
    ...le16(flags), ...le16(2900), ...le16(170), ...le16(160), 0xe8, 0x03, 0x00, ...le16(12), ...le16(-5 & 0xffff), ...le16(190),
    ...le16(250), ...le16(700), 12, 150, 75, ...le16(1800), ...le16(600),
  ));
  assert.deepEqual(d, {
    averageSpeed: 29, cadence: 85, averageCadence: 80, distance: 1000, resistance: 12, power: -5, averagePower: 190,
    calories: 250, caloriesPerHour: 700, caloriesPerMinute: 12, hr: 150, met: 7.5, time: 1800, remaining: 600,
  });
  assert.equal(d.speed, undefined, 'bit 0 set: no instantaneous speed');
});

test('ftms bike: ranges, features and commands', () => {
  assert.deepEqual(parsePowerRange(view(...le16(0), ...le16(2000), ...le16(1))), { min: 0, max: 2000, step: 1 });
  assert.deepEqual(parseResistanceRange(view(...le16(0), ...le16(1000), ...le16(10))), { min: 0, max: 100, step: 1 });
  const f = parseFeatures(view(...le16((1 << 1) | (1 << 14)), 0, 0, ...le16((1 << 2) | (1 << 3) | (1 << 13)), 0, 0));
  assert.deepEqual([f.cadenceReported, f.powerReported, f.powerTarget, f.resistanceTarget, f.simulationTarget, f.speedTarget], [true, true, true, true, true, false]);
  assert.deepEqual([...setTargetPower(250)], [0x05, 0xfa, 0x00]);
  assert.deepEqual([...setTargetResistance(25.5)], [0x04, 255]);
  // wind 0, grade 2.5 % (250), crr 0.004 (40), cw 0.51 (51)
  assert.deepEqual([...setSimulation({ grade: 2.5 })], [0x11, 0, 0, 0xfa, 0x00, 40, 51]);
  assert.deepEqual([...setSimulation({ grade: -1 })].slice(3, 5), [0x9c, 0xff]);
  assert.deepEqual(parseMachineStatus(view(0x08, ...le16(230))), { event: 'target-power', targetPower: 230 });
  assert.deepEqual(parseMachineStatus(view(0x07, 55)), { event: 'target-resistance', targetResistance: 5.5 });
});

/** A fake FTMS machine over a fake GATT: answers control point writes with success. */
function fakeMachine({ bike = true, name = 'KICKR 1234' } = {}) {
  const chars = {};
  const ch = (uuid, value) => {
    const c = {
      uuid, handlers: new Set(), written: [],
      addEventListener(n, f) { this.handlers.add(f); }, removeEventListener(n, f) { this.handlers.delete(f); },
      async startNotifications() {}, async stopNotifications() {},
      async readValue() { return value; },
      notify(v) { for (const h of this.handlers) h({ target: { value: v } }); },
      async writeValueWithResponse(data) { this.written.push([...data]); setTimeout(() => this.notify(view(0x80, data[0], 1)), 1); },
    };
    chars[uuid] = c;
    return c;
  };
  ch(0x2acc, view(...le16((1 << 1) | (1 << 14)), 0, 0, ...le16((1 << 3) | (1 << 13)), 0, 0)); // ERG + simulation, no resistance
  ch(0x2ad8, view(...le16(25), ...le16(1500), ...le16(1)));
  if (bike) ch(0x2ad2);
  ch(0x2ada); ch(0x2ad9);
  const device = {
    name, listeners: {},
    addEventListener(n, f) { this.listeners[n] = f; },
    gatt: { connected: false, async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async (u) => chars[u] }) }; }, disconnect() { this.connected = false; } },
  };
  return { device, chars };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('ftms trainer: connects, reads its range and features, reports data and sends power through the ERG ramp', async () => {
  const { device, chars } = fakeMachine();
  const statuses = [];
  const data = [];
  const logs = [];
  const lost = [];
  const dev = ftmsTrainer.create({ onStatus: (s) => statuses.push(s), onData: (s) => data.push(s), onLog: (k, t) => logs.push([k, t]), onControlLost: () => lost.push(1) });
  dev.setTarget({ power: 200 });                // before connecting: nothing sent, no error
  dev._cancelRamp();
  dev.sentPower = null;
  await dev.connect({ device });
  assert.deepEqual(statuses, ['connecting', 'initializing', 'ready']);
  assert.deepEqual(chars[0x2ad9].written.slice(0, 2), [[0x00], [0x07]]);   // request control, start
  assert.deepEqual([dev.limits.powerMin, dev.limits.powerMax], [25, 1500]);
  assert.deepEqual([dev.capabilities.erg, dev.capabilities.resistance, dev.capabilities.simulation], [true, false, true]);

  chars[0x2ad2].notify(view(...le16(0x0004 | 0x0040 | 0x0200), ...le16(3000), ...le16(180), ...le16(205), 138));
  assert.deepEqual([data.at(-1).speed, data.at(-1).cadence, data.at(-1).power, data.at(-1).hr, data.at(-1).hrSource], [30, 90, 205, 138, 'trainer']);

  dev.rampSeconds = 0.04;
  dev.rampMs = 10;
  dev.setTarget({ power: 100 });                // first target: straight away
  await wait(20);
  dev.setTarget({ power: 2000 });               // clamped to 1500, reached through the ramp
  await wait(80);
  const powers = chars[0x2ad9].written.filter((w) => w[0] === 0x05).map((w) => w[1] | (w[2] << 8));
  assert.equal(powers[0], 100);
  assert.equal(powers.at(-1), 1500);
  assert.ok(powers.length >= 4, `ramp ${powers}`);
  assert.ok(powers.every((p, i) => !i || p >= powers[i - 1]));

  dev.setSimulation({ grade: 3 });
  dev.stop();
  await wait(20);
  const tail = chars[0x2ad9].written.slice(-2);
  assert.deepEqual(tail, [[0x11, 0, 0, 0x2c, 0x01, 40, 51], [0x08, 1]]);

  chars[0x2ada].notify(view(0xff));
  assert.ok(logs.some(([k, t]) => k === 'warn' && /another app/.test(t)));
  assert.equal(lost.length, 1);
  dev.disconnect();
  assert.equal(statuses.at(-1), 'disconnected');
  assert.equal(dev.connected, false);
});

test('ftms: a bike is refused as a treadmill and a treadmill as a trainer, with a clear message', async () => {
  const bike = fakeMachine({ name: 'KICKR' });
  await assert.rejects(ftmsTreadmill.create({}).connect({ device: bike.device }), /KICKR is not a treadmill/);
  assert.equal(bike.device.gatt.connected, false, 'the link is closed');
  const tm = fakeMachine({ bike: false, name: 'T202' });
  await assert.rejects(ftmsTrainer.create({}).connect({ device: tm.device }), /T202 is not a smart trainer/);
});

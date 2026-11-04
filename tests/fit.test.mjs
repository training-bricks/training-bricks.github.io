// FIT export (#33): the file decoded back, with a minimal decoder
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFit, fitCrc } from '../src/export/fit.js';
import { buildTcx } from '../src/export/tcx.js';

const FIT_EPOCH_S = 631065600;

/** Decodes a FIT file into { sizes, messages: [{ global, fields: { number: value(s) } }] }. */
function decodeFit(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes[0], 14, 'header size');
  assert.equal(String.fromCharCode(...bytes.slice(8, 12)), '.FIT');
  assert.equal(view.getUint16(12, true), fitCrc(bytes.slice(0, 12)), 'header CRC');
  const dataSize = view.getUint32(4, true);
  assert.equal(bytes.length, 14 + dataSize + 2, 'declared size');
  assert.equal(view.getUint16(14 + dataSize, true), fitCrc(bytes.slice(0, 14 + dataSize)), 'file CRC');
  const defs = {};
  const messages = [];
  let at = 14;
  const reader = { 0x00: 'getUint8', 0x02: 'getUint8', 0x84: 'getUint16', 0x86: 'getUint32', 0x8c: 'getUint32' };
  while (at < 14 + dataSize) {
    const head = bytes[at++];
    const local = head & 0x0f;
    if (head & 0x40) {
      const global = view.getUint16(at + 2, true);
      const count = bytes[at + 4];
      at += 5;
      const fields = [];
      for (let i = 0; i < count; i++, at += 3) fields.push({ num: bytes[at], size: bytes[at + 1], type: bytes[at + 2] });
      defs[local] = { global, fields };
      continue;
    }
    const def = defs[local];
    assert.ok(def, 'data message with a definition');
    const out = {};
    for (const f of def.fields) {
      if (f.type === 0x07) {
        out[f.num] = new TextDecoder().decode(bytes.slice(at, at + f.size)).replace(/\0.*$/, '');
      } else {
        const unit = { 0x84: 2, 0x86: 4, 0x8c: 4 }[f.type] ?? 1;
        const values = [];
        for (let i = 0; i < f.size / unit; i++) values.push(view[reader[f.type]](at + i * unit, true));
        out[f.num] = values.length === 1 ? values[0] : values;
      }
      at += f.size;
    }
    messages.push({ global: def.global, fields: out });
  }
  return messages;
}

const of = (messages, global) => messages.filter((m) => m.global === global).map((m) => m.fields);
const T0 = Date.UTC(2026, 10, 2, 9, 0, 0);
const STEPS = [
  { kind: 'Warm-up', warmup: true, zone: 1 },
  { kind: 'Work', zone: 4 },
  { kind: 'Work', zone: 1 },
  { kind: 'Cooldown', cooldown: true, zone: 1 },
];

/** 40 s per step, 1 Hz, with RR. */
function runSamples({ pauseAt = null } = {}) {
  let t = T0;
  return Array.from({ length: 160 }, (_, i) => {
    if (i === pauseAt) t += 30_000;
    const s = { t, elapsed: i, distance: i * 2.5, speed: 9, incline: 2, hr: 140, step: Math.floor(i / 40) + 1, rr: [420, 430, 425] };
    t += 1000;
    return s;
  });
}

test('fit: a treadmill run has one lap per step, its step indexes, intensities and sub-sport', () => {
  const m = decodeFit(buildFit(runSamples(), { sport: 'run', steps: STEPS, name: 'Z2 run', deviceName: 'EXP 5i' }));
  const laps = of(m, 19);
  assert.deepEqual(laps.map((l) => l[71]), [0, 1, 2, 3], 'wkt_step_index');
  assert.deepEqual(laps.map((l) => l[23]), [2, 0, 1, 3], 'warm-up, active, rest, cool-down');
  assert.ok(laps.every((l) => l[25] === 1 && l[39] === 1), 'running + treadmill');
  const session = of(m, 18)[0];
  assert.deepEqual([session[5], session[6], session[26]], [1, 1, 4]);
  assert.equal(of(m, 0)[0][0], 4, 'an activity file');
  assert.equal(of(m, 34)[0][1], 1, 'one session');
  assert.deepEqual(of(m, 23).map((d) => d[27]), ['Brickwise', 'EXP 5i']);
  assert.equal(of(m, 12)[0][3], 'Z2 run');
});

test('fit: the laps add up, and records carry time, distance, speed, HR and altitude', () => {
  const samples = runSamples();
  const m = decodeFit(buildFit(samples, { sport: 'run', steps: STEPS }));
  const records = of(m, 20);
  assert.equal(records.length, 160);
  const r = records[100];
  assert.equal(r[253], Math.round(samples[100].t / 1000) - FIT_EPOCH_S);
  assert.equal(r[5], 25000, 'distance in cm');
  assert.equal(r[6], 2500, 'speed in mm/s');
  assert.equal(r[3], 140);
  assert.equal(r[2], Math.round((samples[100].distance * 0.02 + 500) * 5), 'altitude from the incline');
  assert.equal(r[7], undefined, 'no power on a run');
  const laps = of(m, 19);
  const session = of(m, 18)[0];
  assert.equal(laps.reduce((a, l) => a + l[9], 0), session[9], 'lap distances add up to the session');
  assert.equal(laps.reduce((a, l) => a + l[8], 0), session[8], 'lap timers add up to the session');
  assert.equal(session[8], 159000, 'timer in ms');
  assert.equal(session[16], 140);
});

test('fit: one RR value per beat, in order, in hrv messages', () => {
  const samples = runSamples();
  const m = decodeFit(buildFit(samples, { steps: STEPS }));
  const rr = of(m, 78).flatMap((h) => h[0]).filter((v) => v !== 0xffff);
  assert.deepEqual(rr, samples.flatMap((s) => s.rr));
  // No strap: no hrv messages
  const none = decodeFit(buildFit(samples.map(({ rr: _, ...s }) => s), { steps: STEPS }));
  assert.equal(of(none, 78).length, 0);
});

test('fit: more beats than fit in a message are split, not lost', () => {
  const samples = [{ t: T0, elapsed: 0, distance: 0, speed: 9, hr: 150, rr: [400, 401, 402, 403, 404, 405, 406] }];
  const hrv = of(decodeFit(buildFit(samples)), 78);
  assert.equal(hrv.length, 2);
  assert.deepEqual(hrv[1][0], [405, 406, 0xffff, 0xffff, 0xffff]);
});

test('fit: a pause stops the timer and is not counted', () => {
  const m = decodeFit(buildFit(runSamples({ pauseAt: 60 }), { steps: STEPS }));
  const timers = of(m, 21).filter((e) => e[0] === 0);
  assert.deepEqual(timers.map((e) => e[1]), [0, 4, 0, 4], 'start, stop, start, stop');
  const session = of(m, 18)[0];
  assert.equal(session[8], 158000, 'timer: the second across the pause is not counted');
  assert.equal(session[7], 189000, 'elapsed includes the pause');
});

test('fit: a ride is cycling + virtual, with power and cadence', () => {
  const samples = Array.from({ length: 61 }, (_, i) => ({ t: T0 + i * 1000, elapsed: i, distance: i * 8, speed: 28.8, hr: null, power: 150 + i, cadence: 90, step: 1 }));
  const m = decodeFit(buildFit(samples, { sport: 'ride', steps: [{ kind: 'Work', zone: 2 }] }));
  const session = of(m, 18)[0];
  assert.deepEqual([session[5], session[6]], [2, 58]);
  assert.equal(of(m, 20)[10][7], 160);
  assert.equal(of(m, 20)[10][4], 90);
  assert.equal(of(m, 20)[10][3], 0xff, 'no HR: the invalid value');
  assert.equal(of(m, 20)[10][2], undefined, 'no altitude without incline');
  assert.deepEqual([session[20], session[21], session[18], session[16]], [180, 210, 90, 0xff]);
});

test('fit: a free session is one lap with no step index; no samples is an error', () => {
  const samples = Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * 1000, elapsed: i, distance: i * 2, speed: 7.2, hr: 130, step: null }));
  const laps = of(decodeFit(buildFit(samples)), 19);
  assert.equal(laps.length, 1);
  assert.equal(laps[0][71], 0xffff);
  assert.throws(() => buildFit([]));
});

test('export: the shared climb gives TCX and FIT the same altitude', () => {
  const samples = runSamples();
  const tcx = buildTcx(samples);
  const alts = [...tcx.matchAll(/<AltitudeMeters>([\d.]+)<\/AltitudeMeters>/g)].map((x) => Number(x[1]));
  const fit = of(decodeFit(buildFit(samples, { steps: STEPS })), 20).map((r) => r[2] / 5 - 500);
  assert.ok(Math.abs(alts[100] - fit[100]) < 0.2);
});

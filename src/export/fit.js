/**
 * Builds a FIT activity from the session samples, with no dependencies: the
 * native format of Garmin, Intervals.icu, Strava and TrainingPeaks. Unlike
 * TCX it says indoor (treadmill, virtual ride), keeps one lap per workout step
 * and carries the beat-to-beat RR (hrv messages), so Intervals.icu can compute
 * its own HRV and DFA α1.
 *
 * samples: [{ t: epoch ms, elapsed: s, distance: m, speed: km/h, hr, incline?, power?, cadence?, step?, rr? }]
 * A gap in `t` is a pause: the timer stops (event messages) and it does not
 * count in the timer time.
 */
import { climbedMeters } from './altitude.js';

const FIT_EPOCH_S = 631065600;   // 1989-12-31 00:00 UTC
const PROFILE_VERSION = 2132;
const PAUSE_GAP_MS = 2000;       // samples this far apart: the session was paused
const RR_PER_MESSAGE = 5;

// Base types: [id, size, invalid value]
const ENUM = [0x00, 1, 0xff];
const UINT8 = [0x02, 1, 0xff];
const UINT16 = [0x84, 2, 0xffff];
const UINT32 = [0x86, 4, 0xffffffff];
const UINT32Z = [0x8c, 4, 0];
const STRING = [0x07, 1, 0];

// Global message numbers
const MSG = { fileId: 0, sport: 12, session: 18, lap: 19, record: 20, event: 21, deviceInfo: 23, activity: 34, hrv: 78 };
// Field values of the FIT profile
const SPORT = {
  run: { sport: 1, subSport: 1 },     // running, treadmill
  ride: { sport: 2, subSport: 58 },   // cycling, virtual_activity (Intervals.icu: VirtualRide)
};
const INTENSITY = { active: 0, rest: 1, warmup: 2, cooldown: 3 };
const EVENT = { timer: 0, lap: 9, session: 8, activity: 26 };
const EVENT_TYPE = { start: 0, stop: 1, stopAll: 4 };
const MANUFACTURER_DEVELOPMENT = 255;
const FILE_ACTIVITY = 4;
const LAP_TRIGGER = { time: 1, sessionEnd: 7 };
const SESSION_TRIGGER_ACTIVITY_END = 0;

const CRC_TABLE = [0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400];

/** FIT CRC-16 of bytes, continuing from `crc`. */
export function fitCrc(bytes, crc = 0) {
  for (const b of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[b & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(b >> 4) & 0xf];
  }
  return crc;
}

const fitTime = (ms) => Math.round(ms / 1000) - FIT_EPOCH_S;
const scaled = (v, scale, offset = 0) => (v == null ? null : Math.round((v + offset) * scale));
const mean = (xs) => xs.reduce((a, v) => a + v, 0) / xs.length;

/** Writes messages, defining each shape once (a new local type per shape). */
class FitWriter {
  bytes = [];
  locals = new Map();

  /** fields: [[field number, base type, value (or list, or string)], …] */
  message(global, fields) {
    const encoded = fields.map(([num, type, value]) => {
      if (type === STRING) {
        const text = [...new TextEncoder().encode(String(value ?? ''))].slice(0, 254);
        return [num, type, [...text, 0]];
      }
      return [num, type, Array.isArray(value) ? value : [value]];
    });
    const shape = `${global}|${encoded.map(([n, ty, v]) => `${n}:${ty[0]}:${v.length}`).join(',')}`;
    let local = this.locals.get(shape);
    if (local == null) {
      local = this.locals.size;
      if (local > 15) throw new Error('FIT: too many message shapes');
      this.locals.set(shape, local);
      this.bytes.push(0x40 | local, 0, 0, global & 0xff, global >> 8, encoded.length);
      for (const [n, ty, v] of encoded) this.bytes.push(n, ty[1] * v.length, ty[0]);
    }
    this.bytes.push(local);
    for (const [, [, size, invalid], values] of encoded) {
      for (const value of values) {
        const v = value == null || !Number.isFinite(value) || value < 0 || value > (invalid || Infinity) ? invalid : value;
        for (let i = 0; i < size; i++) this.bytes.push(Math.floor(v / 256 ** i) & 0xff);
      }
    }
  }

  /** Header + messages + file CRC. */
  finish() {
    const header = [14, 0x20, PROFILE_VERSION & 0xff, PROFILE_VERSION >> 8];
    const size = this.bytes.length;
    for (let i = 0; i < 4; i++) header.push(Math.floor(size / 256 ** i) & 0xff);
    header.push(0x2e, 0x46, 0x49, 0x54); // ".FIT"
    const headerCrc = fitCrc(header);
    header.push(headerCrc & 0xff, headerCrc >> 8);
    const crc = fitCrc(this.bytes, fitCrc(header));
    return Uint8Array.from([...header, ...this.bytes, crc & 0xff, crc >> 8]);
  }
}

/** Seconds the timer ran over consecutive samples (pauses left out). */
function timerSeconds(samples) {
  let secs = 0;
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].t - samples[i - 1].t;
    if (gap <= PAUSE_GAP_MS) secs += gap / 1000;
  }
  return secs;
}

/** Consecutive samples of the same step: one lap each (one lap on a free session). */
function splitLaps(samples) {
  const laps = [];
  for (const s of samples) {
    const lap = laps.at(-1);
    if (lap && lap.step === (s.step ?? null)) lap.samples.push(s);
    else laps.push({ step: s.step ?? null, samples: [s] });
  }
  return laps;
}

/** Warm-up, cool-down, the recoveries (Z1 between harder steps), or active. */
function lapIntensity(step, steps) {
  if (step?.warmup) return INTENSITY.warmup;
  if (step?.cooldown) return INTENSITY.cooldown;
  const top = Math.max(0, ...steps.filter((s) => !s.warmup && !s.cooldown).map((s) => s.zone ?? 0));
  return step?.zone === 1 && top > 1 ? INTENSITY.rest : INTENSITY.active;
}

/** The averages lap and session messages share, over some samples. */
function totals(samples) {
  const positive = (key) => samples.map((s) => s[key]).filter((v) => v > 0);
  const hr = positive('hr');
  const cadence = positive('cadence');
  const power = samples.map((s) => s.power).filter((v) => v != null);
  const speed = samples.map((s) => (s.speed ?? 0) / 3.6);
  return {
    avgSpeed: scaled(mean(speed), 1000),
    maxSpeed: scaled(Math.max(...speed), 1000),
    avgHr: hr.length ? Math.round(mean(hr)) : null,
    maxHr: hr.length ? Math.max(...hr) : null,
    avgCadence: cadence.length ? Math.round(mean(cadence)) : null,
    maxCadence: cadence.length ? Math.round(Math.max(...cadence)) : null,
    avgPower: power.length ? Math.round(mean(power)) : null,
    maxPower: power.length ? Math.round(Math.max(...power)) : null,
  };
}

/**
 * @param samples  session samples
 * @param opts.sport 'run' | 'ride'; opts.steps the workout's steps (samples point to them, from 1)
 * @param opts.name the workout; opts.deviceName the treadmill or trainer used
 * @returns {Uint8Array} the .fit file
 */
export function buildFit(samples, { sport = 'run', steps = [], name = null, deviceName = null } = {}) {
  if (!samples.length) throw new Error('No samples to export');
  const ride = sport === 'ride';
  const { sport: fitSport, subSport } = SPORT[ride ? 'ride' : 'run'];
  const start = samples[0].t;
  const end = samples.at(-1).t;
  const w = new FitWriter();

  w.message(MSG.fileId, [
    [0, ENUM, FILE_ACTIVITY], [1, UINT16, MANUFACTURER_DEVELOPMENT], [2, UINT16, 1],
    [3, UINT32Z, Math.floor(start / 1000) >>> 0], [4, UINT32, fitTime(start)],
  ]);
  const device = (index, product) => w.message(MSG.deviceInfo, [
    [253, UINT32, fitTime(start)], [0, UINT8, index], [2, UINT16, MANUFACTURER_DEVELOPMENT], [4, UINT16, 1], [27, STRING, product],
  ]);
  device(0, 'Brickwise');
  if (deviceName) device(1, deviceName);
  w.message(MSG.sport, [[0, ENUM, fitSport], [1, ENUM, subSport], [3, STRING, name ?? (ride ? 'Ride' : 'Run')]]);

  const timerEvent = (ms, type) => w.message(MSG.event, [[253, UINT32, fitTime(ms)], [0, ENUM, EVENT.timer], [1, ENUM, type]]);
  timerEvent(start, EVENT_TYPE.start);

  const altitude = climbedMeters(samples);
  samples.forEach((s, i) => {
    const prev = samples[i - 1];
    if (prev && s.t - prev.t > PAUSE_GAP_MS) {
      timerEvent(prev.t, EVENT_TYPE.stopAll);
      timerEvent(s.t, EVENT_TYPE.start);
    }
    const fields = [
      [253, UINT32, fitTime(s.t)],
      [5, UINT32, scaled(s.distance ?? 0, 100)],
      [6, UINT16, scaled((s.speed ?? 0) / 3.6, 1000)],
      [3, UINT8, s.hr > 0 ? Math.round(s.hr) : null],
    ];
    if (altitude) fields.push([2, UINT16, scaled(altitude[i], 5, 500)]);
    if (ride) fields.push([4, UINT8, s.cadence != null ? Math.round(s.cadence) : null], [7, UINT16, s.power != null ? Math.round(s.power) : null]);
    w.message(MSG.record, fields);
    // RR of that second, in s / 1000; a message has a fixed size, padded with the invalid value
    for (let at = 0; at < (s.rr?.length ?? 0); at += RR_PER_MESSAGE) {
      const part = s.rr.slice(at, at + RR_PER_MESSAGE);
      w.message(MSG.hrv, [[0, UINT16, [...part, ...Array(RR_PER_MESSAGE - part.length).fill(null)]]]);
    }
  });
  timerEvent(end, EVENT_TYPE.stopAll);

  const laps = splitLaps(samples);
  let lastDistance = samples[0].distance ?? 0;
  laps.forEach((lap, i) => {
    const lapStart = lap.samples[0].t;
    const lapEnd = laps[i + 1]?.samples[0].t ?? end;
    const distance = lap.samples.at(-1).distance ?? 0;
    const step = lap.step != null ? steps[lap.step - 1] : null;
    const a = totals(lap.samples);
    const timer = timerSeconds(laps[i + 1] ? [...lap.samples, laps[i + 1].samples[0]] : lap.samples);
    w.message(MSG.lap, [
      [254, UINT16, i], [253, UINT32, fitTime(lapEnd)], [0, ENUM, EVENT.lap], [1, ENUM, EVENT_TYPE.stop], [2, UINT32, fitTime(lapStart)],
      [7, UINT32, scaled((lapEnd - lapStart) / 1000, 1000)], [8, UINT32, scaled(timer, 1000)], [9, UINT32, scaled(distance - lastDistance, 100)],
      [13, UINT16, a.avgSpeed], [14, UINT16, a.maxSpeed], [15, UINT8, a.avgHr], [16, UINT8, a.maxHr],
      [17, UINT8, a.avgCadence], [18, UINT8, a.maxCadence], [19, UINT16, a.avgPower], [20, UINT16, a.maxPower],
      [23, ENUM, lapIntensity(step, steps)], [24, ENUM, laps[i + 1] ? LAP_TRIGGER.time : LAP_TRIGGER.sessionEnd],
      [25, ENUM, fitSport], [39, ENUM, subSport], [71, UINT16, lap.step != null ? lap.step - 1 : null],
    ]);
    lastDistance = distance;
  });

  const a = totals(samples);
  const timer = timerSeconds(samples);
  w.message(MSG.session, [
    [254, UINT16, 0], [253, UINT32, fitTime(end)], [0, ENUM, EVENT.session], [1, ENUM, EVENT_TYPE.stop], [2, UINT32, fitTime(start)],
    [5, ENUM, fitSport], [6, ENUM, subSport], [7, UINT32, scaled((end - start) / 1000, 1000)], [8, UINT32, scaled(timer, 1000)],
    [9, UINT32, scaled((samples.at(-1).distance ?? 0) - (samples[0].distance ?? 0), 100)],
    [14, UINT16, a.avgSpeed], [15, UINT16, a.maxSpeed], [16, UINT8, a.avgHr], [17, UINT8, a.maxHr],
    [18, UINT8, a.avgCadence], [19, UINT8, a.maxCadence], [20, UINT16, a.avgPower], [21, UINT16, a.maxPower],
    [22, UINT16, altitude ? Math.round(altitude.at(-1)) : null], [25, UINT16, 0], [26, UINT16, laps.length], [28, ENUM, SESSION_TRIGGER_ACTIVITY_END],
  ]);
  w.message(MSG.activity, [
    [253, UINT32, fitTime(end)], [0, UINT32, scaled(timer, 1000)], [1, UINT16, 1], [2, ENUM, 0], [3, ENUM, EVENT.activity], [4, ENUM, EVENT_TYPE.stop],
  ]);
  return w.finish();
}

/**
 * Drives the session engine in Node with a fake device and a fake clock:
 * one tick per simulated second, no timers, no Bluetooth. Shared by the
 * session flow tests.
 */
import * as runner from '../../src/session/runner.js';
import * as app from '../../src/state.js';
import { live, rrState } from '../../src/session/live.js';
import { profileFromIntervals, rideFromIntervals } from '../../src/physiology/zones.js';
import { runSettings } from '../fixtures.mjs';

let origin = 1e9; // every session starts on its own stretch of the fake clock

export const RIDE_SETTINGS = { ftp: 200, hr_zones: [130, 145, 155, 165, 175, 185] };

/** A run step at a fixed speed, with optional HR range / zone / flags. */
export const runStep = (o) => ({ label: o.label ?? 'Step', duration: 600, hasTarget: true, speedStart: 9, speedEnd: 9, incline: 1, hr: null, zone: 2, ...o });

export function startSession({ steps, sport = 'run', hrOn = false, zones = true, free = false } = {}) {
  // Cycling zones for rides: FTP 200 W, HR Z1 ≤ 130, Z2 131–145
  app.setProfile(zones ? { ...profileFromIntervals(runSettings), ride: rideFromIntervals(RIDE_SETTINGS) } : null);
  const sent = [];
  const kind = sport === 'ride' ? 'trainer' : 'treadmill';
  const device = {
    connected: true,
    state: { updatedAt: 0 },
    limits: { speedMin: 0.8, speedMax: 16, inclineMin: 0, inclineMax: 10, powerMin: 0, powerMax: 1500 },
    setTarget: (t) => sent.push({ ...t, at: runner.session.totalElapsed }),
    pause: () => sent.push({ pause: true, at: runner.session.totalElapsed }),
    pauseNow: () => sent.push({ pauseNow: true, at: runner.session.totalElapsed }),
    stop: () => sent.push({ stop: true, at: runner.session.totalElapsed }),
  };
  app.setDevice(kind, device);
  // free: no workout selected, the session takes its sport from the page (start({ sport }))
  app.setSelection(free ? null : { key: 'l:test', event: { name: 'Test', sport }, steps, hrOn });
  Object.assign(rrState, { lastAt: 0, alpha: null, pending: [] });
  live.hr = null;
  let now = (origin += 1e7);

  const tickOnce = ({ speed = 9, cadence = 90, hr = null, alpha1, fresh = true } = {}) => {
    now += 1000;
    if (fresh) device.state.updatedAt = now;
    live.speed = speed;
    live.incline = 1;
    // On a trainer the rider pedals at `cadence` and the power follows the last target
    if (kind === 'trainer') {
      const w = sent.filter((x) => x.power != null).at(-1)?.power ?? 0;
      live.trainer = cadence > 0 ? { cadence, power: w, speed: 30 } : { cadence: 0, power: 0, speed: 0 };
    }
    live.hr = hr;
    if (alpha1 !== undefined) {
      // A strap with RR is connected: α1 as given, recent enough to count
      Object.assign(rrState, { lastAt: Date.now(), computedAt: Date.now(), alpha: { alpha1 } });
    }
    runner.tick(now);
  };

  runner.start({ sport });
  tickOnce({ speed: 0, cadence: 0 }); // armed, the belt not moving yet: the clock starts here

  return {
    runner,
    session: runner.session,
    device,
    sent,
    /** seconds ticks; values may be functions of the session time (s). */
    run(seconds, { speed = 9, cadence = 90, hr = null, alpha1 } = {}) {
      for (let i = 0; i < seconds; i++) {
        const t = runner.session.totalElapsed;
        tickOnce({
          speed: typeof speed === 'function' ? speed(t) : speed,
          cadence: typeof cadence === 'function' ? cadence(t) : cadence,
          hr: typeof hr === 'function' ? hr(t) : hr,
          alpha1: typeof alpha1 === 'function' ? alpha1(t) : alpha1,
        });
      }
    },
    /** seconds ticks without readings from the device. */
    stale(seconds, opts = {}) {
      for (let i = 0; i < seconds; i++) tickOnce({ ...opts, fresh: false });
    },
    /** Speeds sent: [{ speed, at }] (at = session time in s). */
    speeds: () => sent.filter((s) => s.speed != null).map(({ speed, at }) => ({ speed, at })),
    /** Watts sent to a trainer: [{ power, at }]. */
    powers: () => sent.filter((s) => s.power != null).map(({ power, at }) => ({ power, at })),
  };
}

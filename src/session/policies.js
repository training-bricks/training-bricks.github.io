/**
 * How each sport's session reads its device: which device kind it drives,
 * when the athlete is moving, the speed for distance and the extra sample
 * fields. The runner (runner.js) sends the commands: speed and incline on a
 * treadmill, power on a smart trainer.
 */
import { live, STALE_MS } from './live.js';

const MOVING_KMH = 0.5;    // treadmill: above this the belt is moving
const PEDALING_RPM = 20;   // trainer: above this the rider is pedaling

export const POLICIES = {
  run: {
    sport: 'run',
    kind: 'treadmill',
    moving: () => live.speed >= MOVING_KMH,
    speed: () => live.speed,
    sample: () => ({ speed: live.speed, incline: live.incline }),
    resetStale: () => { live.speed = 0; },
    hrSteerable: true,
    words: { started: 'Belt moving: session started', stopped: 'Belt stopped: session paused', resumed: 'Belt moving: session resumed', done: 'run.note.complete' },
  },
  ride: {
    sport: 'ride',
    kind: 'trainer',
    moving: () => (live.trainer?.cadence ?? 0) >= PEDALING_RPM,
    speed: () => live.trainer?.speed ?? 0,
    sample: () => ({ speed: live.trainer?.speed ?? 0, power: live.trainer?.power ?? null, cadence: live.trainer?.cadence ?? null }),
    resetStale: () => { if (live.trainer) live.trainer = { ...live.trainer, cadence: 0, speed: 0, power: 0 }; },
    hrSteerable: true, // HR on watts in ERG (#8)
    words: { started: 'Pedaling: session started', stopped: 'Pedaling stopped: session paused', resumed: 'Pedaling: session resumed', done: 'ride.note.complete' },
  },
};

/** The policy of a workout's sport, or of the page that starts a free session. */
export const policyFor = (event, sport = 'run') => ((event?.sport ?? sport) === 'ride' ? POLICIES.ride : POLICIES.run);

/** No reading from the device for a while: treat it as stopped. */
export const isStale = (device, now) => !device || now - (device.state?.updatedAt ?? 0) > STALE_MS;

/** Watts a ride step asks for at a progress (0..1): ramps from lo to hi, steady steps at the middle. */
export function powerAt(step, progress) {
  const p = step?.power;
  if (!p) return null;
  if (step.ramp) return Math.round(p.lo + (p.hi - p.lo) * Math.min(1, Math.max(0, progress)));
  return Math.round((p.lo + p.hi) / 2);
}

/** Limits of the workout intensity (%, #39). */
export const INTENSITY_MIN = 70;
export const INTENSITY_MAX = 120;

/** What a workout intensity multiplies a step by: a cool-down never goes above the plan. */
export function intensityFactor(step, pct = 100) {
  const f = pct / 100;
  return step?.cooldown ? Math.min(1, f) : f;
}

/**
 * What the devices report right now: treadmill speed and incline, HR and
 * its source, the console state, and the strap's RR intervals with their
 * DFA α1.
 */

import { alpha1Window } from '../physiology/hrv.js';

export const STALE_MS = 3000;       // no notifications this long → speed unknown

export const live = { speed: 0, incline: 0, hr: null, hrSource: null, console: {}, info: {}, link: {} }; // link: per kind, 'reconnecting' or 'gave-up' after a drop (#37)

// RR intervals (chest strap) and DFA α1 of the last 2 minutes
const ALPHA_EVERY_MS = 5000;
export const rrState = { beats: [], lastAt: 0, alpha: null, computedAt: 0, pending: [] };

export function addRr(list, contact) {
  const now = Date.now();
  // Each beat is timestamped backwards from now, in arrival order
  let t = now - list.slice(1).reduce((a, b) => a + b, 0);
  for (const rr of list) {
    rrState.beats.push({ t, rr });
    rrState.pending.push(rr);
    t += rr;
  }
  rrState.lastAt = now;
  rrState.contact = contact;
  const keep = now - 150_000;
  while (rrState.beats.length && rrState.beats[0].t < keep) rrState.beats.shift();
}

/** Recent RR: without them α1 is not shown (optical sensor, no strap…). */
export const rrActive = () => Date.now() - rrState.lastAt < 10_000;

export function updateAlpha() {
  const now = Date.now();
  if (!rrActive()) { rrState.alpha = null; return; }
  if (now - rrState.computedAt < ALPHA_EVERY_MS) return;
  rrState.computedAt = now;
  rrState.alpha = alpha1Window(rrState.beats, now);
}

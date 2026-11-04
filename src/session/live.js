/**
 * What the devices report right now: treadmill speed and incline, HR and
 * its source, the console state, and the strap's RR intervals with their
 * DFA α1.
 */

import { alpha1Window, cleanRr } from '../physiology/hrv.js';

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

const RR_SILENT_MS = 5000;     // a strap that sent RR and stopped: what it reports is no longer a heartbeat
const RR_RECENT_MS = 10_000;
const RR_JUNK_SHARE = 0.3;     // this much of the last beats unusable: bad contact

/**
 * HR, or null if it cannot be believed. A strap losing contact goes on
 * reporting: on 2026-11-04 it read 141 and then a fixed 71 for a minute after
 * it was taken off, with RR silent or junk. Only a strap with RR can tell.
 */
export function hrNow(now = Date.now()) {
  if (live.hrSource !== 'strap' || !rrState.lastAt) return live.hr;
  if (rrState.contact === false || now - rrState.lastAt > RR_SILENT_MS) return null;
  const beats = rrState.beats.filter((b) => b.t > now - RR_RECENT_MS).map((b) => b.rr);
  return beats.length >= 5 && cleanRr(beats).artifacts / beats.length >= RR_JUNK_SHARE ? null : live.hr;
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

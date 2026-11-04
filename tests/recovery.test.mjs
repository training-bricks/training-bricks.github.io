// Recover the session after a reload (#36): serialise and restore the runner state, with a fake store
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmitter } from '../src/lib/events.js';
import { snapshot, recoverable, createRecovery, SAVE_EVERY_MS, MAX_AGE_MS } from '../src/session/recovery.js';
import { buildFit } from '../src/export/fit.js';
import { startSession, runStep } from './session/harness.mjs';
import * as runner from '../src/session/runner.js';

/** What a reload does to a session: only what the store kept survives. */
const reload = (h, now = 1) => {
  const saved = JSON.parse(JSON.stringify(snapshot(h.session, now)));
  h.runner.resetSession();
  return saved;
};

const fakeStore = () => {
  const m = new Map();
  return { m, get: (k) => m.get(k), set: (k, v) => { m.set(k, v); }, del: (k) => { m.delete(k); } };
};

test('recovery: reload in the middle of a step comes back paused at the same step and time, with all samples', () => {
  const h = startSession({ steps: [runStep({ duration: 60 }), runStep({ duration: 300, speedStart: 10, speedEnd: 10 })], hrOn: false });
  h.run(100, { hr: 140 });
  h.runner.setIntensity(95);
  h.session.adjust = 0.5;
  const before = { step: h.session.stepIdx, elapsed: h.session.stepElapsed, total: h.session.totalElapsed, dist: h.session.totalDist, samples: h.session.samples.length };
  const saved = reload(h);
  assert.equal(h.session.state, 'idle');
  h.runner.restoreSession(saved);
  const s = h.session;
  assert.equal(s.state, 'paused');
  assert.equal(s.policy.kind, 'treadmill');
  assert.deepEqual({ step: s.stepIdx, elapsed: s.stepElapsed, total: s.totalElapsed, dist: s.totalDist, samples: s.samples.length }, before);
  assert.equal(s.intensity, 95);
  assert.equal(s.adjust, 0.5);
  assert.equal(s.steps.length, 2);
  assert.equal(runner.isActive(), true);
});

test('recovery: moving again resumes it and sends the target; the file has no gap but the pause', () => {
  const h = startSession({ steps: [runStep({ duration: 300, speedStart: 10, speedEnd: 10 })] });
  h.run(50);
  const lastBefore = h.session.samples.at(-1);
  const saved = reload(h, lastBefore.t);
  h.runner.restoreSession(saved);
  const sent = h.speeds().length;
  h.run(30, { speed: 0 });
  assert.equal(h.session.state, 'paused', 'nothing moves: still paused');
  assert.equal(h.speeds().length, sent, 'nothing sent to a stopped belt');
  h.run(10, { speed: 10 });
  assert.equal(h.session.state, 'running');
  assert.equal(h.speeds().length, sent + 1);
  assert.equal(h.speeds().at(-1).speed, 10);
  const samples = h.session.samples;
  const elapsed = samples.map((x) => x.elapsed);
  assert.deepEqual(elapsed, elapsed.map((_, i) => i), 'one sample per second of session time, none lost or repeated');
  const gaps = samples.slice(1).map((x, i) => x.t - samples[i].t).filter((g) => g > 2000);
  assert.equal(gaps.length, 1, 'the pause');
  assert.ok(h.session.stats.pauses >= 1);
  assert.ok(h.session.stats.pausedMs >= 25_000);
  assert.ok(buildFit(samples, { steps: h.session.steps }).length > 100);
});

test('recovery: a ride comes back on its device', () => {
  const h = startSession({ sport: 'ride', steps: [{ label: 'Z2', duration: 300, hasTarget: false, power: { lo: 150, hi: 150 }, zone: 2, hr: null, incline: 0 }] });
  h.run(30);
  h.runner.restoreSession(reload(h));
  assert.equal(h.session.policy.kind, 'trainer');
  h.run(3);
  assert.equal(h.session.state, 'running');
  assert.equal(h.powers().at(-1).power, 150);
});

test('recovery: a finished session comes back finished, without saving its metrics again', () => {
  const h = startSession({ steps: [runStep({ duration: 30 })] });
  h.run(40);
  assert.equal(h.session.state, 'done');
  const saved = reload(h);
  const runs = [];
  const ends = [];
  runner.events.on('run', (r) => runs.push(r));
  runner.events.on('cue', (c) => { if (c.kind === 'end') ends.push(c); });
  h.runner.restoreSession(saved);
  assert.equal(h.session.state, 'done');
  assert.equal(runner.isActive(), false);
  assert.deepEqual([runs.length, ends.length], [0, 0]);
});

test('recovery: ending it here keeps what was recorded, as a finished session', () => {
  const h = startSession({ steps: [runStep({ duration: 300 })] });
  h.run(30);
  const count = h.session.samples.length;
  h.runner.restoreSession(reload(h));
  h.runner.finish('ended');
  assert.equal(h.session.state, 'done');
  assert.equal(h.session.samples.length, count);
  assert.equal(h.sent.at(-1).pauseNow, undefined);
});

test('recovery: what is worth offering', () => {
  const ok = { savedAt: 1000, session: { samples: [{}], uploaded: false } };
  assert.equal(recoverable(ok, 2000), true);
  assert.equal(recoverable(ok, 1000 + MAX_AGE_MS), false, 'too old');
  assert.equal(recoverable({ ...ok, session: { samples: [] } }, 2000), false, 'nothing recorded');
  assert.equal(recoverable({ ...ok, session: { samples: [{}], uploaded: true } }, 2000), false, 'already uploaded');
  assert.equal(recoverable(null), false);
});

test('recovery: saves every 10 s, at the end and on request; a new session or an upload clears it', async () => {
  const store = fakeStore();
  const events = createEmitter();
  const session = { state: 'running', samples: [{}], policy: { sport: 'ride' } };
  const r = createRecovery({ store, session, events, now: () => 5000 });
  events.emit('tick', 20_000);
  assert.equal(store.m.get('session').savedAt, 20_000);
  assert.equal(store.m.get('session').sport, 'ride');
  assert.equal(store.m.get('session').session.policy, undefined, 'the policy has functions');
  events.emit('tick', 20_000 + SAVE_EVERY_MS - 1);
  assert.equal(store.m.get('session').savedAt, 20_000);
  events.emit('tick', 20_000 + SAVE_EVERY_MS);
  assert.equal(store.m.get('session').savedAt, 30_000);
  session.state = 'done';
  events.emit('change');
  assert.equal(store.m.get('session').session.state, 'done', 'saved at the end');
  r.save(40_000);
  assert.equal(store.m.get('session').savedAt, 40_000, 'on pagehide');
  events.emit('uploaded');
  assert.equal(store.m.size, 0);
  session.state = 'running';
  r.save(50_000);
  session.state = 'armed';
  events.emit('change');
  assert.equal(store.m.size, 0, 'another session');
});

test('recovery: nothing recorded is not saved; a stale copy is forgotten on load', async () => {
  const store = fakeStore();
  const session = { state: 'armed', samples: [], policy: null };
  const r = createRecovery({ store, session, events: createEmitter() });
  r.save(1000);
  assert.equal(store.m.size, 0);
  store.set('session', { savedAt: 1000, session: { samples: [{}] } });
  assert.ok(await r.load(2000));
  assert.equal(await r.load(1000 + MAX_AGE_MS + 1), null);
  assert.equal(store.m.size, 0);
  assert.equal(await r.load(2000), null);
});

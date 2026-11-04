import test from 'node:test';
import assert from 'node:assert/strict';

test('runner: loads in Node, with no window, document or AudioContext', async () => {
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.document, 'undefined');
  const runner = await import('../src/session/runner.js');
  assert.equal(typeof runner.tick, 'function');
  assert.equal(runner.session.state, 'idle');
});

test('runner: a short workout runs from the belt start to the end', async () => {
  const { session, events, start, tick } = await import('../src/session/runner.js');
  const { setDevice, setSelection } = await import('../src/state.js');
  const { live } = await import('../src/session/live.js');

  const sent = [];
  const device = {
    connected: true,
    state: { updatedAt: 0 },
    limits: { speedMin: 0.8, speedMax: 16, inclineMin: 0, inclineMax: 10 },
    setTarget: ({ speed, incline }) => {
      if (incline != null) sent.push(['incline', incline]);
      if (speed != null) sent.push(['speed', speed]);
    },
    pause: () => sent.push(['pause']),
  };
  setDevice('treadmill', device);
  const step = (label, kmh, duration) => ({ label, duration, hasTarget: true, speedStart: kmh, speedEnd: kmh, incline: 1, hr: null });
  setSelection({ key: 'l:test', event: { name: 'Test' }, steps: [step('A', 8, 3), step('B', 9, 3)], hrOn: false });

  const seen = { change: 0, active: [], notes: [] };
  events.on('change', () => seen.change++);
  events.on('active', (on) => seen.active.push(on));
  events.on('note', ({ text }) => seen.notes.push(text));

  start();
  assert.equal(session.state, 'armed');
  assert.deepEqual(seen.active, [true]);

  // The belt starts: the first step's speed and incline go out
  let now = 10_000;
  const at = (t) => { device.state.updatedAt = t; live.speed = 8; tick(t); };
  at(now);
  assert.equal(session.state, 'running');
  assert.deepEqual(sent.slice(0, 2), [['incline', 1], ['speed', 8]]);

  // 3 s later the second step starts
  for (let i = 0; i < 4; i++) at((now += 1000));
  assert.equal(session.stepIdx, 1);
  assert.ok(sent.some(([k, v]) => k === 'speed' && v === 9));

  // At its end the session is done and the belt slows down bit by bit before
  // it pauses: never from running speed to 0 at once
  for (let i = 0; i < 4; i++) at((now += 1000));
  assert.equal(session.state, 'done');
  assert.notDeepEqual(sent.at(-1), ['pause']);
  for (let i = 0; i < 40; i++) at((now += 1000));
  assert.deepEqual(sent.at(-1), ['pause']);
  const end = sent.slice(sent.findIndex(([k, v]) => k === 'incline' && v === 0));
  const slow = end.filter(([k]) => k === 'speed').map(([, v]) => v);
  assert.deepEqual(slow, [7.5, 7, 6.5, 6, 5.5, 5, 4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.8]); // from the belt's 8 km/h
  assert.deepEqual(seen.active, [true, false]);
  assert.match(seen.notes.at(-1), /Workout complete/);
  assert.ok(seen.change >= 4);
  assert.ok(session.samples.length >= 7);
});

test('runner: the plan keeps its speed; what is sent is clamped to the treadmill', async () => {
  const { session, start, tick, finish } = await import('../src/session/runner.js');
  const { setDevice, setSelection } = await import('../src/state.js');
  const { live } = await import('../src/session/live.js');
  const { flattenWorkout } = await import('../src/workouts/steps.js');
  const steps = flattenWorkout({ steps: [{ duration: 60, text: 'incline 14%', _pace: { value: 19 / 3.6 } }] });
  assert.equal(steps[0].speedStart, 19);
  assert.equal(steps[0].incline, 14);
  const sent = [];
  const device = {
    connected: true, state: { updatedAt: 0 },
    limits: { speedMin: 0.8, speedMax: 16, inclineMin: 0, inclineMax: 10 },
    // Like Treadmill.setTarget: the incline is clamped by the device itself
    setTarget: ({ speed, incline }) => sent.push({ speed, incline: incline != null ? Math.min(10, incline) : undefined }),
    pause() {},
  };
  setDevice('treadmill', device);
  setSelection({ key: 'l:fast', event: { name: 'Fast' }, steps, hrOn: false });
  start();
  device.state.updatedAt = 50_000; live.speed = 10; tick(50_000);
  assert.equal(session.state, 'running');
  assert.deepEqual(sent.find((c) => c.speed != null).speed, 16);
  assert.equal(sent.find((c) => c.incline != null).incline, 10);
  finish('test over');
});

test('policies: the sport picks the device and how moving is read', async () => {
  const { policyFor, powerAt } = await import('../src/session/policies.js');
  assert.equal(policyFor({ sport: 'ride' }).kind, 'trainer');
  assert.equal(policyFor({ sport: 'run' }).kind, 'treadmill');
  assert.equal(policyFor(null).kind, 'treadmill');
  assert.equal(powerAt({ power: { lo: 100, hi: 150 }, ramp: true }, 0.5), 125);
  assert.equal(powerAt({ power: { lo: 190, hi: 210 } }, 0.9), 200);
  assert.equal(powerAt({ speedStart: 9 }, 0.5), null);
});

test('runner: a ride drives the trainer with the step watts and pauses when pedaling stops', async () => {
  const { session, start, tick } = await import('../src/session/runner.js');
  const { setDevice, setSelection } = await import('../src/state.js');
  const { live } = await import('../src/session/live.js');
  const sent = [];
  const trainer = {
    connected: true, state: { updatedAt: 0 },
    limits: { powerMin: 0, powerMax: 1500 },
    setTarget: ({ power }) => sent.push(power),
    stop: () => sent.push('stop'),
  };
  setDevice('trainer', trainer);
  const steps = [
    { label: 'Ramp', duration: 4, ramp: true, power: { lo: 100, hi: 150 }, hasTarget: false, incline: 1, hr: null },
    { label: 'Steady', duration: 8, power: { lo: 190, hi: 210 }, hasTarget: false, incline: 1, hr: null },
  ];
  setSelection({ key: 'i:0', event: { name: 'Ride', sport: 'ride' }, steps, hrOn: false });
  start();
  assert.equal(session.state, 'armed');

  let now = 100_000;
  const at = (t, cadence = 90) => { trainer.state.updatedAt = t; live.trainer = { cadence, speed: 30, power: 150 }; tick(t); };
  at(now - 1000, 0);                                // not pedaling yet: still armed (and the clock starts here)
  assert.equal(session.state, 'armed');
  at(now);
  assert.equal(session.state, 'running');
  assert.equal(sent[0], 100);                       // ramp start
  for (let i = 0; i < 3; i++) at((now += 1000));
  assert.deepEqual(sent.slice(1, 4), [113, 125, 138], `ramp ${sent}`);
  assert.equal(session.stepIdx, 1);
  assert.equal(sent.at(-1), 200);                   // steady step at the middle of 190–210
  // Pedaling stops for more than 2 s: paused; back: resumed and the watts resent
  at((now += 1000), 0); at((now += 1000), 0); at((now += 1500), 0);
  assert.equal(session.state, 'paused');
  const n = sent.length;
  at((now += 1000));
  assert.equal(session.state, 'running');
  assert.equal(sent[n], 200);
  assert.ok(session.samples.at(-1).cadence === 90 && 'power' in session.samples.at(-1));
  for (let i = 0; i < 6; i++) at((now += 1000));
  assert.equal(session.state, 'done');
  assert.equal(sent.at(-1), 'stop');
});

test('runner: one sample per whole second even when ticks arrive late (smooth pace from distance)', async () => {
  const { session, start, tick, finish } = await import('../src/session/runner.js');
  const { setDevice, setSelection } = await import('../src/state.js');
  const { live } = await import('../src/session/live.js');
  const device = { connected: true, state: { updatedAt: 0 }, limits: { speedMin: 0.8, speedMax: 16 }, setTarget() {}, pause() {} };
  setDevice('treadmill', device);
  const step = { label: 'A', duration: 600, hasTarget: true, speedStart: 9, speedEnd: 9, incline: 0, hr: null };
  setSelection({ key: 'l:grid', event: { name: 'Grid' }, steps: [step], hrOn: false });
  let now = 500_000;
  const at = (t) => { device.state.updatedAt = t; live.speed = 9; tick(t); };
  at(now); // primes the clock
  start();
  // Ticks 260 ms apart (late, like a busy browser) and one 1.7 s stall
  for (let i = 0; i < 120; i++) at((now += i === 60 ? 1700 : 260));
  const s = session.samples;
  assert.ok(s.length >= 30);
  s.forEach((x, i) => assert.equal(x.elapsed, i)); // no second skipped
  for (let i = 1; i < s.length; i++) {
    assert.equal(s[i].t - s[i - 1].t, 1000);
    assert.ok(Math.abs(s[i].distance - s[i - 1].distance - 2.5) < 1e-6); // 9 km/h = 2.5 m/s every second
  }
  finish('test over');
});

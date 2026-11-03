// Voice cues (#38): the text and timing from runner events; the speech with a fake synth
import test from 'node:test';
import assert from 'node:assert/strict';
import { cueText, cueAllowed, cueTtl, GROUPS, CUE_GROUPS } from '../src/session/voice-cues.js';
import { createSpeaker } from '../src/lib/speech.js';
import { setLanguage } from '../src/i18n/index.js';
import { startSession, runStep } from './session/harness.mjs';
import * as runner from '../src/session/runner.js';

const ride = { power: { lo: 171, hi: 171 }, duration: 360 };
const run = { hasTarget: true, speedStart: 7.2, speedEnd: 7.2, duration: 360 };

test('voice: the next step, in each language', async () => {
  assert.equal(cueText({ kind: 'next', step: ride }), 'Next: 6 minutes at 171 watts');
  assert.equal(cueText({ kind: 'next', step: run }), 'Next: 6 minutes at 8:20');
  assert.equal(cueText({ kind: 'next', step: ride, factor: 0.95 }), 'Next: 6 minutes at 162 watts');
  assert.equal(cueText({ kind: 'next', step: { duration: 90, power: { lo: 100, hi: 100 } } }), 'Next: 90 seconds at 100 watts');
  assert.equal(cueText({ kind: 'next', step: { distance: 500, hasTarget: false } }), 'Next: 500 meters');
  globalThis.document = { documentElement: {}, querySelectorAll: () => [], dispatchEvent() {} };
  try {
    await setLanguage('es');
    assert.equal(cueText({ kind: 'next', step: run }), 'Siguiente: 6 minutos a 8:20');
    assert.equal(cueText({ kind: 'next', step: ride }), 'Siguiente: 6 minutos a 171 vatios');
    assert.equal(cueText({ kind: 'hr', delta: -0.5, unit: 'km/h' }), 'Pulso alto: baja 0,5');
    assert.equal(cueText({ kind: 'paused' }), 'En pausa');
    await setLanguage('fr');
    assert.equal(cueText({ kind: 'next', step: ride }), 'Suivant : 6 minutes à 171 watts');
    assert.equal(cueText({ kind: 'link', state: 'back' }), 'Connexion rétablie');
  } finally {
    await setLanguage('en');
    delete globalThis.document;
  }
});

test('voice: HR control, α1, state and connection', () => {
  assert.equal(cueText({ kind: 'hr', delta: -0.5, unit: 'km/h' }), 'HR high: down 0.5');
  assert.equal(cueText({ kind: 'hr', delta: 5, unit: 'W' }), 'HR low: up 5 watts');
  assert.equal(cueText({ kind: 'countdown', n: 3 }), '3');
  assert.match(cueText({ kind: 'alpha', on: true }), /low/);
  assert.equal(cueText({ kind: 'link', state: 'reconnecting' }), 'Connection lost, reconnecting');
  assert.equal(cueText({ kind: 'link', state: 'nope' }), null);
  assert.equal(cueText({ kind: 'nope' }), null);
});

test('voice: the settings let each group through; off by default', () => {
  assert.equal(cueAllowed({ kind: 'next' }, { on: false, cues: {} }), false);
  assert.equal(cueAllowed({ kind: 'next' }, { on: true, cues: {} }), true, 'a cue not listed is on');
  assert.equal(cueAllowed({ kind: 'paused' }, { on: true, cues: { state: false } }), false);
  assert.equal(cueAllowed({ kind: 'end' }, { on: true, cues: { hr: false } }), true);
  for (const g of Object.values(CUE_GROUPS)) assert.ok(GROUPS.includes(g));
  assert.ok(cueTtl({ kind: 'countdown' }) < cueTtl({ kind: 'paused' }));
});

/** The cues of a session, with the second they came. */
function collect(h) {
  const out = [];
  runner.events.on('cue', (c) => out.push({ ...c, at: Math.round(h.session.totalElapsed) }));
  return out;
}

test('voice: each cue once, at the right moment of a session', () => {
  const h = startSession({ steps: [runStep({ duration: 60 }), runStep({ duration: 60, speedStart: 10, speedEnd: 10 })] });
  const cues = collect(h);
  h.run(35);
  h.run(5, { speed: 0 });
  h.run(160);
  const of = (kind) => cues.filter((c) => c.kind === kind);
  assert.equal(of('next').length, 1, 'the last step has no next');
  assert.equal(of('next')[0].step.speedStart, 10);
  assert.ok(of('next')[0].at >= 49 && of('next')[0].at <= 51, `next at ${of('next')[0].at}`);
  assert.deepEqual(of('countdown').map((c) => c.n), [3, 2, 1, 3, 2, 1], 'one count per second, per step');
  assert.equal(of('paused').length, 1);
  assert.equal(of('resumed').length, 1);
  assert.equal(of('end').length, 1);
  assert.equal(cues.at(-1).kind, 'end');
});

test('voice: a short step is not announced, and intensity counts', () => {
  const short = startSession({ steps: [runStep({ duration: 15 }), runStep({ duration: 60 })] });
  const a = collect(short);
  short.run(20);
  assert.equal(a.filter((c) => c.kind === 'next').length, 0);
  const h = startSession({ steps: [runStep({ duration: 30 }), runStep({ duration: 60 })] });
  const b = collect(h);
  h.runner.setIntensity(90);
  h.run(25);
  assert.equal(b.find((c) => c.kind === 'next').factor, 0.9);
});

test('voice: HR control moves are cues, and a countdown beep says it is one', () => {
  const Z2 = { lo: 135, hi: 150, mode: 'target' };
  const h = startSession({ steps: [runStep({ hr: Z2, duration: 90 })], hrOn: true });
  const cues = collect(h);
  const beeps = [];
  runner.events.on('beep', (b) => beeps.push(b));
  h.run(92, { hr: 170 });
  const hr = cues.filter((c) => c.kind === 'hr');
  assert.ok(hr.length >= 1);
  assert.ok(hr.every((c) => c.delta < 0 && c.unit === 'km/h'));
  assert.equal(beeps.filter((b) => b.countdown).length, 3);
  assert.equal(h.session.stats.hrDrops, hr.length);
});

/** A fake speechSynthesis on a clock moved by hand. */
function fakeSpeech() {
  let t = 0;
  const said = [];
  let current = null;
  const synth = { speak(u) { said.push({ text: u.text, lang: u.lang, volume: u.volume }); current = u; }, cancel() { current = null; } };
  class Utterance { constructor(text) { this.text = text; } }
  const timers = new Set();
  const speaker = createSpeaker({
    synth, Utterance, now: () => t,
    setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.add(x); return x; },
    clearTimer: (x) => timers.delete(x),
  });
  return { speaker, said, finish: () => current?.onend?.(), advance: (ms) => { t += ms; for (const x of [...timers]) if (x.at <= t) { timers.delete(x); x.fn(); } } };
}

test('speech: one at a time, in order, with language and volume', () => {
  const f = fakeSpeech();
  f.speaker.say('one', { lang: 'es', volume: 0.5 });
  f.speaker.say('two');
  assert.deepEqual(f.said, [{ text: 'one', lang: 'es', volume: 0.5 }]);
  f.finish();
  assert.equal(f.said[1].text, 'two');
});

test('speech: what waited too long is dropped', () => {
  const f = fakeSpeech();
  f.speaker.say('long sentence');
  f.speaker.say('3', { ttl: 1 });
  f.speaker.say('still useful', { ttl: 15 });
  f.advance(3000);
  f.finish();
  assert.deepEqual(f.said.map((s) => s.text), ['long sentence', 'still useful']);
});

test('speech: an utterance that never ends does not block the queue; no speech does nothing', () => {
  const f = fakeSpeech();
  f.speaker.say('stuck');
  f.speaker.say('next', { ttl: 60 });
  f.advance(11_000);
  assert.equal(f.said.at(-1).text, 'next');
  const none = createSpeaker({ synth: undefined, Utterance: undefined });
  assert.equal(none.available, false);
  assert.doesNotThrow(() => none.say('x'));
  assert.doesNotThrow(() => none.cancel());
});

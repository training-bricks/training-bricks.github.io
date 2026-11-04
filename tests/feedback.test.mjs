// RPE and Feel after a session (#34)
import test from 'node:test';
import assert from 'node:assert/strict';
import { feedbackFields, pickAnswer, rpeLabel, feelLabel, RPE_VALUES, FEEL_VALUES } from '../src/session/feedback.js';
import { updateActivity, setApiKey } from '../src/services/intervals.js';

test('feedback: the activity fields only carry what was answered', () => {
  assert.equal(feedbackFields({}), null, 'skipping the panel sends nothing');
  assert.equal(feedbackFields({ rpe: null, feel: null }), null);
  assert.deepEqual(feedbackFields({ rpe: 6, feel: null }), { icu_rpe: 6 });
  assert.deepEqual(feedbackFields({ rpe: null, feel: 2 }), { feel: 2 });
  assert.deepEqual(feedbackFields({ rpe: 7, feel: 3 }), { icu_rpe: 7, feel: 3 });
});

test('feedback: the panel keeps a value from its list, and no answer as null', () => {
  assert.equal(pickAnswer('7', RPE_VALUES), 7);
  assert.equal(pickAnswer('', RPE_VALUES), null);
  assert.equal(pickAnswer('11', RPE_VALUES), null);
  assert.equal(pickAnswer('6', FEEL_VALUES), null);
  assert.equal(pickAnswer('1', FEEL_VALUES), 1);
});

test('feedback: CR10 words where the scale has them', () => {
  assert.equal(rpeLabel(1), '1 · Very easy');
  assert.equal(rpeLabel(6), '6');
  assert.equal(feelLabel(1), '1 · Strong');
  assert.equal(feelLabel(5), '5 · Weak');
});

test('intervals: updateActivity is a JSON PUT on the activity, outside /athlete/0', async () => {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response('{"id":"i1"}', { status: 200 }); };
  setApiKey('k');
  try {
    await updateActivity('i1', { icu_rpe: 6, feel: 2 });
  } finally {
    globalThis.fetch = real;
    setApiKey('');
  }
  assert.equal(calls[0].url, 'https://intervals.icu/api/v1/activity/i1');
  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].init.body, '{"icu_rpe":6,"feel":2}');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.match(calls[0].init.headers.Authorization, /^Basic /);
});

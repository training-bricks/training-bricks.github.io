import test from 'node:test';
import assert from 'node:assert/strict';
import { noteClosing, noteClosingProgress, takeLastClosing } from '../src/session/closing.js';

const stored = new Map();
globalThis.localStorage = {
  getItem: (k) => stored.get(k) ?? null,
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};

const AT = Date.UTC(2026, 10, 4, 21, 30, 5);

test('closing: the log line tells the events, the speed and how far the pause got, once', () => {
  noteClosing('beforeunload', 8, AT);
  noteClosingProgress(0, 2);
  noteClosingProgress(1, 2);
  noteClosing('pagehide', 8, AT + 200);
  assert.equal(takeLastClosing(), 'Page closed at 21:30:05 (beforeunload, pagehide) at 8 km/h: 1 of 2 pause packets written');
  assert.equal(takeLastClosing(), null);
});

test('closing: a failed write and a device that sent nothing are told apart', () => {
  noteClosing('pagehide', 6, AT);
  noteClosingProgress(null, 2, new Error('GATT error'));
  assert.match(takeLastClosing(), /0 of 2 pause packets written, then: GATT error/);

  noteClosing('pagehide', 6, AT);
  assert.match(takeLastClosing(), /no pause packets reported/);
});

test('closing: an old note does not mix with a new close', () => {
  noteClosing('pagehide', 6, AT);
  noteClosing('beforeunload', 8, AT + 60_000);
  assert.match(takeLastClosing(), /\(beforeunload\) at 8 km\/h/);
});

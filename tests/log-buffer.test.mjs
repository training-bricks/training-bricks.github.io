import test from 'node:test';
import assert from 'node:assert/strict';
import { trimLog } from '../src/lib/log-buffer.js';

const line = (kind, i) => `00:00:00.000 ${kind.padEnd(5)} ${i}`;

test('log: when it is full the oldest traffic goes and the events stay', () => {
  const lines = [line('INFO', 'connected'), line('INFO', 'profile')];
  for (let i = 0; i < 12; i++) lines.push(line(i % 2 ? 'TX' : 'RX', i));
  lines.push(line('WARN', 'late'));
  trimLog(lines, 10, 6);
  assert.equal(lines.length, 9);
  assert.deepEqual(lines.slice(0, 2), [line('INFO', 'connected'), line('INFO', 'profile')]);
  assert.equal(lines[2], line('RX', 6), 'the newest traffic stays');
  assert.equal(lines.at(-1), line('WARN', 'late'));
});

test('log: under the limit nothing goes; with too little traffic the oldest lines do', () => {
  const short = [line('TX', 1), line('INFO', 2)];
  trimLog(short, 10, 6);
  assert.equal(short.length, 2);

  const lines = [line('INFO', 0), line('INFO', 1), line('TX', 2), line('INFO', 3), line('INFO', 4)];
  trimLog(lines, 4, 3);
  assert.deepEqual(lines, [line('INFO', 3), line('INFO', 4)]);
});

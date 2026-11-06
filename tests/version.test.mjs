// The Version card of Configuration, and the file the deploy replaces
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatAgo, formatStamp } from '../src/i18n/format.js';
import { VERSION } from '../version.js';
import { versionInfo } from '../src/ui/version.js';

const now = Date.parse('2026-11-04T19:00:00Z');
const ago = (s) => formatAgo(new Date(now - s * 1000), now, { lang: 'en' });

test('formatStamp: numbers, padded, in local time', () => {
  assert.equal(formatStamp(new Date(2026, 10, 4, 13, 25, 0)), '2026/11/04 13:25:00');
  assert.equal(formatStamp(new Date(2027, 0, 2, 3, 4, 5)), '2027/01/02 03:04:05');
});

test('formatAgo: the largest unit that fits, in the language', () => {
  assert.equal(ago(20), 'now');
  assert.equal(ago(35 * 60), '35 minutes ago');
  assert.equal(ago(5 * 3600), '5 hours ago');
  assert.equal(ago(3 * 86400), '3 days ago');
  assert.equal(ago(70 * 86400), '2 months ago');
  assert.equal(ago(800 * 86400), '2 years ago');
  assert.equal(formatAgo(new Date(now - 2100_000), now, { lang: 'es' }), 'hace 35 minutos');
  assert.equal(formatAgo(new Date(now - 2100_000), now, { lang: 'fr' }), 'il y a 35 minutes');
  assert.equal(formatAgo(new Date(now + 5000), now, { lang: 'en' }), 'now', 'a clock behind the server');
});

test('version: running locally says dev, with no link and no date', () => {
  assert.deepEqual(VERSION, { sha: 'dev', deployedAt: null });
  assert.deepEqual(versionInfo(VERSION), { commit: 'dev', href: null, deployed: '—' });
});

test('version: a published one shows the short commit, links to it, and has its date', () => {
  const sha = '56ccc43047358ad9937c43089830ee69b6d17916';
  const deployedAt = new Date(now - 35 * 60_000).toISOString();
  const info = versionInfo({ sha, deployedAt }, now);
  assert.equal(info.commit, '56ccc43');
  assert.equal(info.href, `https://github.com/training-bricks/training-bricks.github.io/commit/${sha}`);
  assert.equal(info.deployed, `${formatStamp(deployedAt)} (35 minutes ago)`);
});

test('version: the deploy writes the file the app imports, with the same names', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(yml, /cat > version\.js/);
  assert.match(yml, /export const VERSION = \{ sha: '\$GITHUB_SHA', deployedAt: '\$\(date -u \+%FT%TZ\)' \};/);
});

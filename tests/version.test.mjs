// The version in the footer, and the file the deploy replaces
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatAgo } from '../src/i18n/format.js';
import { VERSION } from '../version.js';
import { versionInfo } from '../src/ui/version.js';

const now = Date.parse('2026-11-04T19:00:00Z');
const ago = (s) => formatAgo(new Date(now - s * 1000), now, { lang: 'en' });

test('formatAgo: the largest unit that fits, in the language', () => {
  assert.equal(ago(20), 'now');
  assert.equal(ago(30 * 60), '30 minutes ago');
  assert.equal(ago(5 * 3600), '5 hours ago');
  assert.equal(ago(3 * 86400), '3 days ago');
  assert.equal(formatAgo(new Date(now - 1800_000), now, { lang: 'es' }), 'hace 30 minutos');
  assert.equal(formatAgo(new Date(now - 1800_000), now, { lang: 'fr' }), 'il y a 30 minutes');
  assert.equal(ago(60 * 86400), '9/5/26', 'long ago: the date');
  assert.equal(formatAgo(new Date(now + 5000), now, { lang: 'en' }), 'now', 'a clock behind the server');
});

test('version: running locally says dev, with no link', () => {
  assert.deepEqual(VERSION, { sha: 'dev', deployedAt: null });
  assert.deepEqual(versionInfo(VERSION), { text: 'dev', href: null, title: '' });
});

test('version: a published one shows the short commit and links to it', () => {
  const sha = '56ccc43047358ad9937c43089830ee69b6d17916';
  const info = versionInfo({ sha, deployedAt: '2026-11-04T18:23:37Z' }, now);
  assert.match(info.text, /^56ccc43 · 36 minutes ago$/);
  assert.equal(info.href, `https://github.com/ycaceres/brickwise/commit/${sha}`);
  assert.match(info.title, /Published/);
});

test('version: the deploy writes the file the app imports, with the same names', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(yml, /cat > version\.js/);
  assert.match(yml, /export const VERSION = \{ sha: '\$GITHUB_SHA', deployedAt: '\$\(date -u \+%FT%TZ\)' \};/);
});

// The Version card of Configuration, and the file the deploy replaces
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatDateTime } from '../src/i18n/format.js';
import { VERSION } from '../version.js';
import { versionInfo } from '../src/ui/version.js';

test('formatDateTime: the whole date and the time, in the language', () => {
  const noon = '2026-11-04T12:00:00';               // local: the same in any time zone
  assert.match(formatDateTime(noon, { lang: 'en' }), /^Wednesday, November 4, 2026 at 12:00\sPM$/);
  assert.match(formatDateTime(noon, { lang: 'es' }), /^miércoles, 4 de noviembre de 2026, 12:00/);
  assert.match(formatDateTime(noon, { lang: 'fr' }), /^mercredi 4 novembre 2026 à 12:00$/);
});

test('version: running locally says dev, with no link and no date', () => {
  assert.deepEqual(VERSION, { sha: 'dev', deployedAt: null });
  assert.deepEqual(versionInfo(VERSION), { commit: 'dev', href: null, deployed: '—' });
});

test('version: a published one shows the short commit, links to it, and has its date', () => {
  const sha = '56ccc43047358ad9937c43089830ee69b6d17916';
  const info = versionInfo({ sha, deployedAt: '2026-11-04T18:23:37Z' });
  assert.equal(info.commit, '56ccc43');
  assert.equal(info.href, `https://github.com/ycaceres/brickwise/commit/${sha}`);
  assert.match(info.deployed, /2026/);
});

test('version: the deploy writes the file the app imports, with the same names', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(yml, /cat > version\.js/);
  assert.match(yml, /export const VERSION = \{ sha: '\$GITHUB_SHA', deployedAt: '\$\(date -u \+%FT%TZ\)' \};/);
});

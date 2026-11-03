import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import en from '../src/i18n/en.js';
import { LANGUAGES, t, placeholders, missingKeys } from '../src/i18n/index.js';
import { formatNumber, formatDate } from '../src/i18n/format.js';
import { PAGE_FILES } from '../src/lib/pages.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const dictionaries = async () => Promise.all(LANGUAGES.map(async (l) => [l.code, (await l.load()).default]));

test('i18n: t() returns English, the key when missing, and fills {vars}', () => {
  assert.equal(t('nav.home'), 'Home');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(t('x {n} y', { n: 3 }), 'x 3 y');
});

test('i18n: every data-i18n key in the page exists in English', () => {
  const html = [read('../index.html'), ...PAGE_FILES.map((n) => read(`../pages/${n}.html`))].join('\n');
  const keys = [...html.matchAll(/data-i18n(?:-label|-placeholder)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(k in en, `missing in en.js: ${k}`);
});

test('i18n: every t(\'…\') key used in the code exists in English', () => {
  const files = fs.readdirSync(new URL('../src/', import.meta.url), { recursive: true }).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    for (const [, k] of read(`../src/${f}`).matchAll(/\bt\('([a-z][\w.-]*)'/g)) assert.ok(k in en, `${f}: ${k}`);
  }
});

test('i18n: languages only use English keys, with the same placeholders and all plural forms', async () => {
  for (const [code, dict] of await dictionaries()) {
    const forms = new Intl.PluralRules(code).resolvedOptions().pluralCategories;
    for (const [key, msg] of Object.entries(dict)) {
      assert.ok(key in en, `${code}: ${key} is not an English key`);
      assert.deepEqual(placeholders(msg), placeholders(en[key]), `${code}: placeholders of ${key}`);
      if (typeof msg === 'object') for (const f of forms) if (f !== 'many') assert.ok(f in msg || 'other' in msg, `${code}: ${key} lacks ${f}`);
    }
    const missing = missingKeys(dict);
    if (missing.length) console.warn(`i18n: ${code} misses ${missing.length} keys (English shows instead)`);
  }
});

test('i18n: plural messages follow the language rules', () => {
  en['test.steps'] = { one: '{n} step', other: '{n} steps' };
  try {
    assert.equal(t('test.steps', { n: 1 }), '1 step');
    assert.equal(t('test.steps', { n: 7 }), '7 steps');
    assert.equal(t('test.steps'), '{n} steps');
  } finally {
    delete en['test.steps'];
  }
  assert.deepEqual(placeholders({ one: '{n} step', other: '{n} steps of {name}' }), ['n', 'name']);
});

test('i18n: numbers and dates in the language', () => {
  assert.equal(formatNumber(7.5, { decimals: 1 }), '7.5');
  assert.equal(formatNumber(7.5, { decimals: 1, lang: 'es' }), '7,5');
  assert.equal(formatNumber(7.5, { decimals: 1, lang: 'fr' }), '7,5');
  assert.equal(formatDate('2026-10-28T12:00:00', { lang: 'es' }), '28/10/26');
  assert.match(formatDate('2026-10-28T12:00:00'), /10\/28\/26/);
});

test('i18n: no visible English text is left without a key in the page HTML', () => {
  // Text written by the code (ids below) and names that are not translated are skipped
  const BY_CODE = ['wName', 'wDesc', 'wTotal', 'wLibCount', 'sessionNote', 'pNote', 'pKeyNote', 'pTestApply', 'pTestApplyRide', 'rideNote', 'cInfo', 'btnStart', 'btnUpload', 'devTables', 'log', 'pillTreadmill', 'pillTrainer', 'pillHr',
    'mPace', 'mSpeedSub', 'mHr', 'mHrSub', 'mAlpha', 'mAlphaSub', 'mDist', 'mTime', 'mIncline', 'mInclineSub', 'rtPower', 'rtCadence', 'rtSpeed', 'rtTarget', 'rtLevel'];
  const KEEP = new Set(['Brickwise', 'Intervals.icu', 'HRM', 'Treadmill', 'Trainer', 'km', 'bpm', 'min/km', 'W', 'rpm', 'km/h', 'α1', '%', 'Pa:HR']);
  for (const file of ['../index.html', ...PAGE_FILES.map((n) => `../pages/${n}.html`)]) {
    const html = read(file).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
    const stack = [];
    for (const tok of html.match(/<[^>]+>|[^<]+/g)) {
      if (tok.startsWith('</')) { stack.pop(); continue; }
      if (tok.startsWith('<')) {
        if (/^<(input|br|img|meta|link|!)/i.test(tok) || tok.endsWith('/>')) continue;
        const id = tok.match(/\sid="([^"]+)"/)?.[1];
        stack.push(/\sdata-i18n(-html)?="/.test(tok) || BY_CODE.includes(id));
        continue;
      }
      const text = tok.replace(/&\w+;/g, ' ').replace(/\s+/g, ' ').trim();
      if (!text || !/[A-Za-z]/.test(text) || KEEP.has(text)) continue;
      assert.ok(stack.some(Boolean), `${file}: "${text}" has no data-i18n`);
    }
  }
});

test('i18n: HTML messages only use simple markup', () => {
  const allowed = new Set(['b', 'i', 'span', 'ul', 'li', 'p', 'h2', 'div']);
  for (const [key, msg] of Object.entries(en).filter(([k]) => k.endsWith('_html'))) {
    for (const [, tag] of msg.matchAll(/<\/?([a-z0-9]+)/gi)) assert.ok(allowed.has(tag.toLowerCase()), `${key}: <${tag}>`);
    assert.ok(!/\son\w+=|javascript:/i.test(msg), `${key}: no handlers or javascript: links`);
  }
});

test('i18n: the browser language picks a supported one', async () => {
  const { pickLanguage } = await import('../src/i18n/detect.js');
  assert.equal(pickLanguage(['es-MX', 'en'], ['en', 'es']), 'es');
  assert.equal(pickLanguage(['de-DE', 'fr-CA'], ['en', 'fr']), 'fr');
  assert.equal(pickLanguage(['de'], ['en']), 'en');
  assert.equal(pickLanguage([], ['en', 'es']), 'en');
  assert.equal(pickLanguage(['EN-gb'], ['en', 'es']), 'en');
  assert.equal(pickLanguage(['pt-BR', 'pt', 'es'], ['en', 'es']), 'es');
  assert.equal(pickLanguage(['fr-CA'], ['fr', 'fr-CA']), 'fr-CA');
  const { SETTINGS } = await import('../src/lib/settings.js');
  assert.equal(SETTINGS.lang.fallback, 'system');
});

test('i18n: the translations are complete', async () => {
  for (const [code, dict] of await dictionaries()) assert.deepEqual(missingKeys(dict), [], `${code} misses keys`);
});

test('i18n: French and Spanish plurals and typography', async () => {
  const { setLanguage } = await import('../src/i18n/index.js');
  globalThis.document = { documentElement: {}, querySelectorAll: () => [], dispatchEvent() {} };
  try {
    await setLanguage('fr');
    assert.equal(t('common.steps', { n: 0 }), '0 étape');   // French: 0 is singular
    assert.equal(t('common.steps', { n: 1 }), '1 étape');
    assert.equal(t('common.steps', { n: 3 }), '3 étapes');
    assert.equal(t('run.uploadFailed', { error: 'x' }), 'Échec de l’envoi : x'); // narrow no-break space before ':'
    await setLanguage('es');
    assert.equal(t('common.steps', { n: 0 }), '0 pasos');
    assert.equal(t('common.steps', { n: 1 }), '1 paso');
    assert.equal(t('nav.home'), 'Inicio');
  } finally {
    await setLanguage('en');
    delete globalThis.document;
  }
});

test('i18n: overlapping language switches end on the last one asked', async () => {
  const { setLanguage, getLanguage, LANGUAGES } = await import('../src/i18n/index.js');
  globalThis.document = { documentElement: {}, querySelectorAll: () => [], dispatchEvent() {} };
  const slow = { code: 'zz', name: 'Slow', native: 'Slow', dir: 'ltr', load: () => new Promise((r) => setTimeout(() => r({ default: {} }), 30)) };
  LANGUAGES.push(slow);
  try {
    const first = setLanguage('zz');   // still downloading…
    await setLanguage('en');           // …when the user picks English
    await first;
    assert.equal(getLanguage(), 'en');
    assert.equal(document.documentElement.lang, 'en');
  } finally {
    LANGUAGES.splice(LANGUAGES.indexOf(slow), 1);
    await setLanguage('en');
    delete globalThis.document;
  }
});

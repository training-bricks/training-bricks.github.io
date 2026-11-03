/**
 * History of α1 threshold tests (newest first), kept in the "tests" setting,
 * and how a result reads. No DOM: the session saves results here and
 * Profile shows them.
 */
import * as settings from '../lib/settings.js';
import { formatPace } from '../workouts/steps.js';
import { t } from '../i18n/index.js';

export const TESTS_KEPT = 20;

export function loadTests() {
  return settings.get('tests');
}

/** Adds a result (from physiology/thresholds.js analyzeRamp) and returns the history. */
export function addTest(result, date = new Date()) {
  const tests = [{ date: date.toISOString(), ...result }, ...loadTests()].slice(0, TESTS_KEPT);
  settings.set('tests', tests);
  return tests;
}

/** A threshold: at a pace on a run, at some watts on a bike (#40). */
export const vtText = (vt) => (vt.w != null ? t('tests.vtRide', { hr: vt.hr, w: vt.w }) : t('tests.vt', { hr: vt.hr, pace: formatPace(vt.kmh) }));

/** The latest test of a sport with a VT2, to use in the profile. Entries from before rides carry no sport: they are runs. */
export const lastWithVt2 = (tests, sport) => tests.find((x) => x.vt2 && (x.sport ?? 'run') === sport) ?? null;
export const testText = (r) => `VT1 ${vtText(r.vt1)} · VT2 ${r.vt2 ? `${vtText(r.vt2)}${r.vt2.extrapolated ? ` (${t('tests.extrapolated')})` : ''}` : t('tests.notReached')}`;

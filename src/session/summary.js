/**
 * What happened in a session, in a few lines for the Intervals.icu activity
 * description (#35), in the interface language: what HR control did, the
 * aerobic metrics or the threshold test, pauses, the cool-down, the workout
 * intensity and how it felt. Lines that do not apply are left out. No DOM.
 */
import { formatDuration } from '../workouts/format.js';
import { formatNumber } from '../i18n/format.js';
import { t } from '../i18n/index.js';
import { runText } from './run-history.js';
import { testText } from './test-history.js';
import { rpeLabel, feelLabel } from './feedback.js';

const signed = (v, unit, decimals) => `${v > 0 ? '+' : '−'}${formatNumber(Math.abs(v), { decimals })} ${unit}`;

/** "HR control: 6 rises (+30 W), 0 drops · α1 guard 2×" */
function hrLine(s) {
  const c = s.stats;
  const parts = [];
  if (s.hrOn) {
    const moved = (key, n, total) => t(key, { n }) + (n ? ` (${signed(total, c.unit, c.unit === 'W' ? 0 : 1)})` : '');
    parts.push(t('summary.hrControl', { rises: moved('summary.rises', c.hrRises, c.hrUp), drops: moved('summary.drops', c.hrDrops, -c.hrDown) }));
    if (c.inclineMoves) parts.push(t('summary.incline', { n: c.inclineMoves }));
    if (c.alphaGuards) parts.push(t('summary.alphaGuard', { n: c.alphaGuards }));
  }
  return parts.join(' · ');
}

/** Pa:HR or Pw:HR with VT1, or the threshold test. */
function metricsLine(s) {
  if (s.testResult) return t('summary.test', { result: testText(s.testResult) });
  if (s.testError) return t('tests.failed', { error: s.testError });
  return s.aerobic ? runText(s.aerobic) : '';
}

/** "Paused 3× (1:12) · Cool-down started at 105 W" */
function eventsLine(s) {
  const c = s.stats;
  return [
    c.pauses ? t('summary.paused', { n: c.pauses, time: formatDuration(c.pausedMs / 1000) }) : '',
    c.cooldownFrom != null ? t('summary.cooldown', { value: `${c.cooldownFrom} ${c.unit}` }) : '',
  ].filter(Boolean).join(' · ');
}

/** "Intensity 95 %", or the range if it changed; nothing at 100 %. */
function intensityLine(s) {
  const all = s.samples.map((x) => x.intensity).filter((v) => v != null);
  if (!all.length) return '';
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  if (lo === 100 && hi === 100) return '';
  return t('summary.intensity', { pct: lo === hi ? lo : `${lo}–${hi}` });
}

function feedbackLine(s) {
  return [s.rpe != null ? `RPE ${rpeLabel(s.rpe)}` : '', s.feel != null ? `${t('summary.feel')} ${feelLabel(s.feel)}` : ''].filter(Boolean).join(' · ');
}

/** The summary of a finished session, one line per topic; '' with nothing to tell. */
export function sessionSummary(s) {
  return [hrLine(s), metricsLine(s), eventsLine(s), intensityLine(s), feedbackLine(s)].filter(Boolean).join('\n');
}

/** The activity description: the page's sentence and, unless turned off, the summary. */
export function uploadDescription(description, s, { summary = true } = {}) {
  const text = summary ? sessionSummary(s) : '';
  return [description, text].filter(Boolean).join('\n\n');
}

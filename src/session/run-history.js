/**
 * History of steady aerobic runs with their metrics (#4, newest first), kept
 * in the "runs" setting, and how they read. No DOM: the session saves runs
 * here and Profile shows them.
 */
import * as settings from '../lib/settings.js';
import { formatNumber } from '../i18n/format.js';
import { t } from '../i18n/index.js';

export const RUNS_KEPT = 50;
export const DECOUPLING_GOOD = 5;   // % under which the aerobic base held for that pace
export const DECOUPLING_HIGH = 10;  // % over which the pace was too much that day

export function loadRuns() {
  return settings.get('runs');
}

/** Adds a run (from physiology/aerobic.js aerobicSummary) and returns the history. */
export function addRun(run, date = new Date()) {
  const runs = [{ date: date.toISOString(), ...run }, ...loadRuns()].slice(0, RUNS_KEPT);
  settings.set('runs', runs);
  return runs;
}

/** 'good' | 'fair' | 'high' for a decoupling in %. */
export const decouplingLevel = (pct) => (pct < DECOUPLING_GOOD ? 'good' : pct <= DECOUPLING_HIGH ? 'fair' : 'high');

export const decouplingText = (d) => `${formatNumber(d.pct, { decimals: 1 })} % (${t(`aerobic.level.${decouplingLevel(d.pct)}`)})`;

/** VT1 of the run, or α1 at the run's HR when there is no line, or that there was no α1. */
export function vt1Text(run) {
  if (run.vt1) return t('aerobic.vt1', { hr: run.vt1.hr });
  if (run.alpha) return t('aerobic.alphaAt', { alpha: formatNumber(run.alpha.median, { decimals: 2 }), hr: run.alpha.hr });
  return t('aerobic.noAlpha');
}

export const runText = (run) => `Pa:HR ${decouplingText(run.decoupling)} · ${vt1Text(run)}`;

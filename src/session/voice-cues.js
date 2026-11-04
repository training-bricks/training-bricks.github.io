/**
 * What a session's cues say (#38): from the runner's 'cue' events to the text
 * in the interface language, and which setting each belongs to. No DOM and no
 * speech: lib/speech.js says it.
 *
 * Cues: { kind: 'next', step, factor }, { kind: 'countdown', n }, { kind: 'hr', delta, unit },
 * { kind: 'alpha', on }, { kind: 'paused' | 'resumed' | 'end' }, { kind: 'link', state }.
 */
import { formatPace } from '../workouts/format.js';
import { formatNumber } from '../i18n/format.js';
import { t } from '../i18n/index.js';
import { powerAt } from './policies.js';

/** The setting that turns each kind of cue on or off. */
export const CUE_GROUPS = { next: 'next', countdown: 'countdown', hr: 'hr', alpha: 'alpha', paused: 'state', resumed: 'state', end: 'state', link: 'link' };
export const GROUPS = ['next', 'countdown', 'hr', 'alpha', 'state', 'link'];

// Seconds a cue may wait for its turn: a countdown is useless a second later
const TTL_S = { countdown: 1.5, next: 8 };
const DEFAULT_TTL_S = 15;
export const cueTtl = (cue) => TTL_S[cue.kind] ?? DEFAULT_TTL_S;

/** "6 minutes", "90 seconds", "500 meters", or '' for a step with no length. */
function lengthText(step) {
  if (step.duration) {
    const whole = step.duration % 60 === 0;
    return whole ? t('voice.minutes', { n: step.duration / 60 }) : t('voice.seconds', { n: step.duration });
  }
  return step.distance ? t('voice.meters', { n: step.distance }) : '';
}

/** "171 watts", "8:20", or '' for a free step. */
function targetText(step, factor) {
  if (step.power) return t('voice.watts', { n: Math.round(powerAt(step, 0) * factor) });
  if (step.hasTarget) return formatPace(step.speedStart * factor);
  return '';
}

function nextText({ step, factor = 1 }) {
  const length = lengthText(step);
  const target = targetText(step, factor);
  const what = length && target ? t('voice.lengthAt', { length, target }) : length || target || t('common.free');
  return t('voice.next', { what });
}

function hrText({ delta, unit }) {
  const watts = unit === 'W';
  const n = Math.abs(delta);
  const value = watts ? t('voice.watts', { n }) : formatNumber(n, { decimals: 1 });
  return t(delta < 0 ? 'voice.hrDown' : 'voice.hrUp', { value });
}

const LINK = { 'hr-lost': 'voice.hrLost', 'hr-plan': 'voice.hrPlan', 'hr-back': 'voice.hrBack', reconnecting: 'voice.linkLost', back: 'voice.linkBack', stuck: 'voice.linkStuck' };

/** What a cue says, or null. */
export function cueText(cue) {
  switch (cue.kind) {
    case 'next': return nextText(cue);
    case 'countdown': return String(cue.n);
    case 'hr': return hrText(cue);
    case 'alpha': return t(cue.on ? 'voice.alphaOn' : 'voice.alphaOff');
    case 'paused': return t('voice.paused');
    case 'resumed': return t('voice.resumed');
    case 'end': return t('voice.end');
    case 'link': return LINK[cue.state] ? t(LINK[cue.state]) : null;
    default: return null;
  }
}

/** Whether the voice settings let a cue through. */
export function cueAllowed(cue, voice) {
  return !!voice?.on && voice.cues?.[CUE_GROUPS[cue.kind]] !== false;
}

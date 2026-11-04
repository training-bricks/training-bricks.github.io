/**
 * How the session felt (#34): RPE 1–10 (Borg CR10) and Feel 1–5 (Intervals.icu's
 * scale: 1 strong … 5 weak), both optional. No DOM: the bar asks, the session
 * keeps the answers, and they go to the activity with a PUT after the upload.
 */
import { t } from '../i18n/index.js';

export const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const FEEL_VALUES = [1, 2, 3, 4, 5];

/** "1 · Very easy"; 6, 8 and 9 have no word of their own on the CR10 scale. */
export function rpeLabel(v) {
  return [6, 8, 9].includes(v) ? String(v) : `${v} · ${t(`rpe.${v}`)}`;
}

export const feelLabel = (v) => `${v} · ${t(`feel.${v}`)}`;

/** The answers as fields of an Intervals.icu activity, or null without any. */
export function feedbackFields({ rpe = null, feel = null } = {}) {
  if (rpe == null && feel == null) return null;
  return { ...(rpe != null && { icu_rpe: rpe }), ...(feel != null && { feel }) };
}

/** A value picked in the panel: a number from the list, or null ('' = no answer). */
export function pickAnswer(value, allowed) {
  const n = Number(value);
  return value !== '' && allowed.includes(n) ? n : null;
}

/** Numbers and dates written the way the interface language does (7.5 / 7,5; 28/10/2026). */
import { getLanguage } from './index.js';

export function formatNumber(v, { decimals = 0, lang = getLanguage() } = {}) {
  return new Intl.NumberFormat(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

export function formatDate(d, { style = 'short', lang = getLanguage() } = {}) {
  return new Intl.DateTimeFormat(lang, { dateStyle: style }).format(new Date(d));
}

/** The whole date and the time: "Wednesday, November 4, 2026 at 1:49 PM". */
export function formatDateTime(d, { lang = getLanguage() } = {}) {
  return new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(d));
}

/** Numbers and dates written the way the interface language does (7.5 / 7,5; 28/10/2026). */
import { getLanguage } from './index.js';

export function formatNumber(v, { decimals = 0, lang = getLanguage() } = {}) {
  return new Intl.NumberFormat(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

/** "30 minutes ago", in the largest unit that fits. */
export function formatAgo(d, now = Date.now(), { lang = getLanguage() } = {}) {
  const s = Math.max(0, (now - new Date(d)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  if (s < 60) return rtf.format(0, 'second');
  if (s < 3600) return rtf.format(-Math.floor(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.floor(s / 3600), 'hour');
  if (s < 30 * 86400) return rtf.format(-Math.floor(s / 86400), 'day');
  return formatDate(d, { lang });
}

export function formatDate(d, { style = 'short', lang = getLanguage() } = {}) {
  return new Intl.DateTimeFormat(lang, { dateStyle: style }).format(new Date(d));
}

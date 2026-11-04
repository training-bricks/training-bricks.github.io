/** Numbers and dates written the way the interface language does (7.5 / 7,5; 28/10/2026). */
import { getLanguage } from './index.js';

export function formatNumber(v, { decimals = 0, lang = getLanguage() } = {}) {
  return new Intl.NumberFormat(lang, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(v);
}

export function formatDate(d, { style = 'short', lang = getLanguage() } = {}) {
  return new Intl.DateTimeFormat(lang, { dateStyle: style }).format(new Date(d));
}

/** A date and time as numbers, in this device's time zone: 2026/11/04 13:25:00. */
export function formatStamp(d) {
  const t = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}/${p(t.getMonth() + 1)}/${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
}

/** "35 minutes ago", in the largest unit that fits. */
export function formatAgo(d, now = Date.now(), { lang = getLanguage() } = {}) {
  const s = Math.max(0, (now - new Date(d)) / 1000);
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const [unit, size] = units.find(([, secs]) => s >= secs) ?? ['second', 0];
  return rtf.format(size ? -Math.floor(s / size) : 0, unit);
}

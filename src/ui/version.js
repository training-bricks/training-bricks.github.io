/**
 * The version in the page footer: the commit this page is running and how long
 * ago it was published. Without a publish (running locally), just 'dev'.
 */
import { VERSION } from '../../version.js';
import { $ } from '../lib/dom.js';
import { every } from '../lib/timer.js';
import { formatAgo, formatDate } from '../i18n/format.js';
import { t } from '../i18n/index.js';

const REPO = 'https://github.com/ycaceres/brickwise';
const REFRESH_MS = 60_000;

/** What the footer says about a version. */
export function versionInfo({ sha, deployedAt }, now = Date.now()) {
  if (!deployedAt) return { text: sha, href: null, title: '' };
  return {
    text: `${sha.slice(0, 7)} · ${formatAgo(deployedAt, now)}`,
    href: `${REPO}/commit/${sha}`,
    title: t('footer.published', { date: formatDate(deployedAt) }),
  };
}

function render() {
  const { text, href, title } = versionInfo(VERSION);
  const el = $('appVersion');
  el.textContent = text;
  el.title = title;
  if (href) el.href = href;
  else el.removeAttribute('href');
}

export function initVersion() {
  render();
  every(REFRESH_MS, render);
  document.addEventListener('bw-language', render);
}

/**
 * The Version card of Configuration: the commit this page is running and when
 * it was published. Without a publish (running locally), just 'dev'.
 */
import { VERSION } from '../../version.js';
import { $ } from '../lib/dom.js';
import { formatDateTime } from '../i18n/format.js';

const REPO = 'https://github.com/ycaceres/brickwise';

/** What the card says about a version. */
export function versionInfo({ sha, deployedAt }) {
  if (!deployedAt) return { commit: sha, href: null, deployed: '—' };
  return { commit: sha.slice(0, 7), href: `${REPO}/commit/${sha}`, deployed: formatDateTime(deployedAt) };
}

function render() {
  const { commit, href, deployed } = versionInfo(VERSION);
  const link = $('cfgVersionCommit');
  link.textContent = commit;
  if (href) link.href = href;
  else link.removeAttribute('href');
  $('cfgVersionDeployed').textContent = deployed;
}

export function initVersion() {
  render();
  document.addEventListener('bw-language', render);
}

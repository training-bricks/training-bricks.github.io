/**
 * Configuration tab: color palette, language and the session summary on
 * uploads, kept in localStorage (brickwise.theme, brickwise.lang; 'system'
 * follows the browser's language). The palette is also applied by the
 * inline script in index.html before the page paints, to avoid a flash.
 */
import { $ } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import { LANGUAGES, DEFAULT_LANGUAGE, setLanguage, t } from '../i18n/index.js';
import { pickLanguage, browserLanguages } from '../i18n/detect.js';

export const THEMES = ['system', 'light', 'dark', 'monochrome', 'vivid'];

function applyTheme(theme) {
  if (!THEMES.includes(theme)) theme = 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  return theme;
}

/** The language to show for a choice: 'system' follows the browser. */
const resolve = (choice) => (choice === 'system' ? pickLanguage(browserLanguages(), LANGUAGES.map((l) => l.code), DEFAULT_LANGUAGE) : choice);

export function initConfig() {
  const theme = $('cfgTheme');
  const lang = $('cfgLang');
  const system = new Option('', 'system');
  const systemLabel = () => {
    const code = resolve('system');
    system.text = t('config.language.system', { name: LANGUAGES.find((l) => l.code === code)?.native ?? code });
  };
  lang.add(system);
  for (const { code, native } of LANGUAGES) lang.add(new Option(native, code));
  theme.value = applyTheme(settings.get('theme'));
  lang.value = settings.get('lang');
  if (!lang.value) lang.value = 'system';
  setLanguage(resolve(lang.value)).then(systemLabel);
  $('cfgSummary').checked = settings.get('uploadSummary');
  $('cfgSummary').onchange = () => settings.set('uploadSummary', $('cfgSummary').checked);
  theme.onchange = () => settings.set('theme', applyTheme(theme.value));
  lang.onchange = async () => {
    settings.set('lang', lang.value);
    await setLanguage(resolve(lang.value));
    systemLabel();
  };
  // The browser (or OS) language changed: follow it while the choice is "System"
  window.addEventListener('languagechange', async () => {
    if (lang.value === 'system') await setLanguage(resolve('system'));
    systemLabel();
  });
}

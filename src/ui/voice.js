/**
 * Voice cues (#38): says the session's cues with the voice settings, and the
 * settings' part of the Configuration page. Off by default: a session without
 * voice behaves as before. A spoken countdown replaces its beeps.
 */
import { $ } from '../lib/dom.js';
import * as settings from '../lib/settings.js';
import { createSpeaker } from '../lib/speech.js';
import { cueText, cueTtl, cueAllowed, GROUPS } from '../session/voice-cues.js';
import { events as sessionEvents } from '../session/runner.js';
import { getLanguage, t } from '../i18n/index.js';

const speaker = createSpeaker();
const voice = () => settings.get('voice');
const say = (text, ttl) => speaker.say(text, { lang: getLanguage(), volume: voice().volume ?? 1, ttl });

/** Whether the countdown is spoken: then its beeps stay quiet. */
export const countdownSpoken = () => speaker.available && cueAllowed({ kind: 'countdown' }, voice());

function saveVoice() {
  settings.set('voice', {
    on: $('cfgVoice').checked,
    volume: Number($('cfgVoiceVolume').value) / 100,
    cues: Object.fromEntries(GROUPS.map((g) => [g, $(`cfgVoice-${g}`).checked])),
  });
  showVoice();
}

function showVoice() {
  const v = voice();
  $('cfgVoice').checked = !!v.on;
  $('cfgVoiceVolume').value = Math.round((v.volume ?? 1) * 100);
  for (const g of GROUPS) $(`cfgVoice-${g}`).checked = v.cues?.[g] !== false;
  $('cfgVoiceOptions').classList.toggle('hidden', !v.on);
  $('cfgVoiceTest').disabled = !speaker.available;
  $('cfgVoiceNote').classList.toggle('hidden', speaker.available);
}

export function initVoice() {
  sessionEvents.on('cue', (cue) => {
    if (cueAllowed(cue, voice())) say(cueText(cue), cueTtl(cue));
  });
  for (const id of ['cfgVoice', 'cfgVoiceVolume', ...GROUPS.map((g) => `cfgVoice-${g}`)]) $(id).onchange = saveVoice;
  $('cfgVoiceTest').onclick = () => say(t('voice.test'));
  showVoice();
}

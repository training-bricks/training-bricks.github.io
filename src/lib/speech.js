/**
 * Says short sentences one at a time with speechSynthesis (no dependencies).
 * It keeps its own queue, so a sentence that waited too long is dropped
 * instead of talking over what is happening now. Without speech (or in a
 * browser that refuses) it does nothing.
 */
const STUCK_MS = 10_000; // some browsers never tell an utterance ended
const RATE = 0.9;        // a little slower than normal: at the default pace short cues sound clipped
const BETTER = /premium|enhanced|natural|neural|mejorad|améliorée/i; // the system's fuller voices, when installed

/**
 * The best voice for a language ('fr'), or null: asking only by language lets
 * some browsers read in the default voice, whatever its language. Fuller
 * voices first, then Google's, then the one the system prefers for it.
 */
export function pickVoice(voices, lang) {
  const own = voices.filter((v) => v.lang?.toLowerCase().replace('_', '-').split('-')[0] === lang);
  return own.find((v) => BETTER.test(v.name)) ?? own.find((v) => /google/i.test(v.name)) ?? own.find((v) => v.default) ?? own[0] ?? null;
}

/**
 * @param opts.synth, opts.Utterance  window.speechSynthesis and SpeechSynthesisUtterance
 * @param opts.now, opts.setTimer, opts.clearTimer  the clock; tests pass a fake one
 */
export function createSpeaker({
  synth = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  const queue = [];
  let speaking = false;
  let watchdog = null;

  const done = () => {
    clearTimer(watchdog);
    speaking = false;
    pump();
  };

  function pump() {
    if (speaking) return;
    while (queue.length && queue[0].until < now()) queue.shift();
    const next = queue.shift();
    if (!next) return;
    const u = new Utterance(next.text);
    // Asked each time: browsers load their voices some time after the page
    const voice = pickVoice(synth.getVoices?.() ?? [], next.lang);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? next.lang;
    u.rate = RATE;
    u.volume = next.volume;
    u.onend = done;
    u.onerror = done;
    speaking = true;
    watchdog = setTimer(done, STUCK_MS);
    try { synth.speak(u); } catch { done(); }
  }

  return {
    available: !!(synth && Utterance),
    /** Queues a sentence; ttl: seconds it may wait for its turn. */
    say(text, { lang = 'en', volume = 1, ttl = 15 } = {}) {
      if (!synth || !Utterance || !text) return;
      queue.push({ text, lang, volume, until: now() + ttl * 1000 });
      pump();
    },
    /** Quiet, now. */
    cancel() {
      queue.length = 0;
      clearTimer(watchdog);
      speaking = false;
      try { synth?.cancel(); } catch { /* no speech */ }
    },
  };
}

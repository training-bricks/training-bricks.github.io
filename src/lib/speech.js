/**
 * Says short sentences one at a time with speechSynthesis (no dependencies).
 * It keeps its own queue, so a sentence that waited too long is dropped
 * instead of talking over what is happening now. Without speech (or in a
 * browser that refuses) it does nothing.
 */
const STUCK_MS = 10_000; // some browsers never tell an utterance ended

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
    u.lang = next.lang;
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

/**
 * How far the pause got when the page closed (#61). It is stored as it goes,
 * since the page may be gone a moment later, and logged on the next visit:
 * written and a belt that kept running means the treadmill did not obey it.
 */
import * as settings from '../lib/settings.js';

/** The page is closing during a session: the event, and the speed at that moment. */
export function noteClosing(event, speed, now = Date.now()) {
  const was = settings.get('closing');
  const recent = was && now - was.at < 5000;
  settings.set('closing', { ...(recent ? was : { at: now, speed }), events: [...(recent ? was.events : []), event] });
}

/** What pauseNow() reports: packets written of the total, or the error that stopped them. */
export function noteClosingProgress(written, total, error) {
  const was = settings.get('closing');
  if (!was) return;
  settings.set('closing', error ? { ...was, total, error: error.message } : { ...was, written, total });
}

/** The log line of the last close, once, or null. */
export function takeLastClosing() {
  const c = settings.get('closing');
  if (!c) return null;
  settings.remove('closing');
  const when = new Date(c.at).toISOString().slice(11, 19);
  const got = c.total ? `${c.written ?? 0} of ${c.total} pause packets written` : 'no pause packets reported';
  return `Page closed at ${when} (${c.events.join(', ')}) at ${c.speed} km/h: ${got}${c.error ? `, then: ${c.error}` : ''}`;
}

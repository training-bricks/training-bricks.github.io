/**
 * Keeps the session safe from a reload or a closed tab (#36): a web app cannot
 * keep the tab alive, but it can save its state. Saved every SAVE_EVERY_MS and
 * when the page goes away, and when it ends, until it is uploaded or another
 * session starts. No DOM: the store comes from outside (lib/idb.js in the
 * page, a fake in tests) and ui/recovery.js asks what to do with it.
 */
export const SAVE_EVERY_MS = 10_000;
export const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const KEY = 'session';
const WORTH_SAVING = ['running', 'paused', 'done'];

/** The session as plain data; the policy is rebuilt from its sport. */
export function snapshot(session, now = Date.now()) {
  const { policy, ...rest } = session;
  return { savedAt: now, sport: policy?.sport ?? 'run', session: rest };
}

/** A saved session worth offering: recent, with samples and not uploaded. */
export function recoverable(saved, now = Date.now()) {
  return !!saved?.session?.samples?.length && !saved.session.uploaded && now - saved.savedAt < MAX_AGE_MS;
}

/**
 * @param store   { get(key), set(key, value), del(key) }, possibly async
 * @param session the runner's session
 * @param events  the runner's events
 * @returns {{ load(now?), save(now?), clear() }}
 */
export function createRecovery({ store, session, events, now = Date.now }) {
  let lastSave = 0;
  const worth = () => WORTH_SAVING.includes(session.state) && session.samples.length > 0;
  const save = (at = now()) => {
    if (!worth()) return;
    lastSave = at;
    store.set(KEY, snapshot(session, at));
  };
  const clear = () => { store.del(KEY); };

  events.on('tick', (at) => {
    if (session.state !== 'done' && at - lastSave >= SAVE_EVERY_MS) save(at);
  });
  events.on('change', () => {
    if (session.state === 'armed') clear(); // another session: the old one is gone
    else if (session.state === 'done') save();
  });
  events.on('uploaded', clear);

  return {
    save,
    clear,
    /** What was saved, if worth offering (otherwise it is forgotten). */
    async load(at = now()) {
      const saved = await store.get(KEY);
      if (!saved) return null;
      if (recoverable(saved, at)) return saved;
      clear();
      return null;
    },
  };
}

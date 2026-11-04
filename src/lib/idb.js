/**
 * A minimal key-value store on IndexedDB, for what does not fit in
 * localStorage (a session's samples, #36). Every operation is optional: with
 * IndexedDB blocked or missing, get gives undefined and writes are skipped.
 */
const DB = 'brickwise';
const STORE = 'kv';

let opening = null;
let database = null;
function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => { database = req.result; resolve(database); };
    req.onerror = () => reject(req.error);
  });
  return opening;
}

/** With the database open a write starts at once and commits right away: on pagehide there is no later. */
async function run(mode, op) {
  try {
    const db = database ?? await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      if (mode === 'readwrite') tx.commit?.();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined; // optional
  }
}

export const idbStore = {
  get: (key) => run('readonly', (s) => s.get(key)),
  set: (key, value) => run('readwrite', (s) => s.put(value, key)),
  del: (key) => run('readwrite', (s) => s.delete(key)),
};

/**
 * A minimal key-value store on IndexedDB, for what does not fit in
 * localStorage (a session's samples, #36). Every operation is optional: with
 * IndexedDB blocked or missing, get gives undefined and writes are skipped.
 */
const DB = 'brickwise';
const STORE = 'kv';

let opening = null;
function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function run(mode, op) {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
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

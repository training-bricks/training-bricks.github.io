/**
 * Timers that keep running while the tab is in the background.
 *
 * Chrome throttles setTimeout/setInterval in hidden tabs (down to once every
 * several seconds), which stretched the treadmill polling loop. Web Worker
 * timers are not throttled, so the waiting happens there. If the Worker cannot
 * be created, plain setTimeout is used.
 */

const SOURCE = 'onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms);';

let worker = null;
let seq = 0;
const waiting = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([SOURCE], { type: 'text/javascript' })));
    worker.onmessage = (e) => {
      const resolve = waiting.get(e.data);
      waiting.delete(e.data);
      resolve?.();
    };
  } catch {
    worker = false;
  }
  return worker;
}

export function sleep(ms) {
  const w = getWorker();
  if (!w) return new Promise((r) => setTimeout(r, ms));
  return new Promise((resolve) => {
    const id = ++seq;
    waiting.set(id, resolve);
    w.postMessage({ id, ms });
  });
}

/** Calls fn every ms milliseconds (calls do not pile up if fn is slow). */
export function every(ms, fn) {
  let stopped = false;
  (async () => {
    while (!stopped) {
      await sleep(ms);
      // Stopped while waiting: no last call (a disconnected simulator kept sending one reading)
      if (stopped) break;
      try { fn(); } catch (err) { console.error(err); }
    }
  })();
  return () => { stopped = true; };
}

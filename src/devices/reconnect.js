/**
 * Automatic reconnection after a Bluetooth drop (#37): retries with backoff
 * while the session needs the device, however long it takes. No DOM and no
 * Bluetooth: attempt() is whatever connects the same device again (a
 * BluetoothDevice reconnects with no chooser and no user gesture). It may not
 * get there alone: once the browser forgets a device it fails right away with
 * "no longer in range" even with the device back (2026-11-04), and only the
 * chooser finds it again. So after STUCK_S it asks for that, and keeps trying.
 */
export const RETRY_DELAYS_S = [1, 2, 4, 8]; // the first attempts…
export const RETRY_EVERY_S = 10;            // …then every this many seconds
export const STUCK_S = 30;                  // not back by now: ask the athlete for a hand

/** Seconds before attempt number `n` (from 0). */
export const retryDelay = (n) => RETRY_DELAYS_S[n] ?? RETRY_EVERY_S;

/**
 * @param opts.attempt     async () => connects; a rejection means "try again"
 * @param opts.shouldRetry () => boolean: false stops quietly (the session ended)
 * @param opts.onState     (state, detail): 'retrying' { attempt, delay }, 'attempt' { attempt },
 *                         'failed' { attempt, error }, 'stuck' (once), 'back', 'stopped'
 * @param opts.clock       { now, setTimeout, clearTimeout }: tests pass a fake one
 */
export function createReconnector({ attempt, shouldRetry = () => true, onState = () => {}, clock = globalThis }) {
  const now = clock.now ?? Date.now;
  let timer = null;
  let run = 0;      // a new start or a stop makes an attempt in flight stale
  let tries = 0;
  let since = 0;
  let active = false;
  let stuck = false;

  const finish = (state) => {
    active = false;
    clock.clearTimeout(timer);
    timer = null;
    run += 1;
    onState(state);
  };

  const schedule = () => {
    const delay = retryDelay(tries);
    onState('retrying', { attempt: tries + 1, delay });
    timer = clock.setTimeout(fire, delay * 1000);
  };

  async function fire() {
    timer = null;
    if (!shouldRetry()) { finish('stopped'); return; }
    const mine = run;
    tries += 1;
    onState('attempt', { attempt: tries });
    try {
      await attempt();
    } catch (error) {
      if (mine !== run) return;
      onState('failed', { attempt: tries, error });
      if (!stuck && now() - since >= STUCK_S * 1000) {
        stuck = true;
        onState('stuck');
      }
      schedule();
      return;
    }
    if (mine === run) finish('back');
  }

  return {
    get active() { return active; },
    /** After an unexpected drop. Nothing if it is already at it. */
    start() {
      if (active || !shouldRetry()) return;
      active = true;
      tries = 0;
      stuck = false;
      since = now();
      schedule();
    },
    /** A manual disconnect or connect: no more retries. */
    stop() {
      if (active) finish('stopped');
    },
  };
}

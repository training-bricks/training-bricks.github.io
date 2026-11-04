/**
 * The card that offers a session left unfinished by a reload or a closed tab
 * (#36): Continue (it comes back paused and the device is connected again;
 * Web Bluetooth needs this click) or end it here, which still lets you export
 * and upload what was recorded. A finished session not uploaded can be opened
 * or deleted.
 */
import { $ } from '../lib/dom.js';
import { idbStore } from '../lib/idb.js';
import { formatDuration } from '../workouts/format.js';
import { createRecovery } from '../session/recovery.js';
import { session, events as sessionEvents, restoreSession, finish } from '../session/runner.js';
import { connectDevice } from './devices.js';
import { showTab, DEBUG } from './tabs.js';
import { log } from './debug.js';
import { t } from '../i18n/index.js';

const hide = () => $('recoverCard').classList.add('hidden');

export async function initRecovery() {
  const recovery = createRecovery({ store: idbStore, session, events: sessionEvents });
  window.addEventListener('pagehide', () => recovery.save());
  const saved = await recovery.load();
  if (!saved) return;

  const finished = saved.session.state === 'done';
  const name = saved.session.event?.name ?? t(saved.sport === 'ride' ? 'ride.freeRide' : 'run.freeSession');
  const kind = saved.sport === 'ride' ? 'trainer' : 'treadmill';
  const tab = saved.sport === 'ride' ? 'ride' : 'run';
  const text = () => {
    $('recoverText').textContent = t(finished ? 'recover.finished' : 'recover.unfinished', { name, time: formatDuration(saved.session.totalElapsed) });
    $('recoverContinue').textContent = t(finished ? 'recover.open' : 'recover.continue');
    $('recoverEnd').textContent = t(finished ? 'recover.delete' : 'recover.end');
  };
  text();
  document.addEventListener('bw-language', text);
  $('recoverCard').classList.remove('hidden');
  // Another session started: the saved one is gone, and Continue must not replace the new one
  sessionEvents.on('change', () => { if (session.state === 'armed') hide(); });

  $('recoverContinue').onclick = () => {
    hide();
    restoreSession(saved);
    log('info', `Session recovered at ${formatDuration(session.totalElapsed)}`);
    showTab(tab);
    // With ?debug=true the simulators are in the device's menu
    if (!finished && !DEBUG) connectDevice(kind);
  };
  $('recoverEnd').onclick = () => {
    hide();
    if (finished) {
      recovery.clear();
      return;
    }
    restoreSession(saved);
    finish(t(saved.sport === 'ride' ? 'ride.note.ended' : 'run.note.endedSaved'));
    showTab(tab);
  };
}

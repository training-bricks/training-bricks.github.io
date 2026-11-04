/**
 * Debug tab (only with ?debug=true): the communication log and what the
 * treadmill console reports.
 */

import { $, download } from '../lib/dom.js';
import { trimLog } from '../lib/log-buffer.js';
import { stateRows } from './format.js';
import { live, STALE_MS } from '../session/live.js';
import { updateControls } from './run.js';
import * as app from '../state.js';
import { events as sessionEvents } from '../session/runner.js';

export const logLines = [];
export function log(kind, text) {
  const line = `${new Date().toISOString().slice(11, 23)} ${kind.toUpperCase().padEnd(5)} ${text}`;
  logLines.push(line);
  trimLog(logLines);
  if ((kind === 'tx' || kind === 'rx') && !$('logTraffic').checked) return;
  const el = document.createElement('div');
  el.className = kind;
  el.textContent = line;
  const box = $('log');
  box.appendChild(el);
  while (box.childElementCount > 400) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

/** Startup: wires the Debug tab. */
export function initDebug() {
  sessionEvents.on('log', ({ kind, text }) => log(kind, text));
  $('btnLogDownload').onclick = () => download(`brickwise-log-${Date.now()}.txt`, logLines.join('\n'), 'text/plain');
}

// What the connected devices report
let lastAlerts;
export function renderConsole() {
  const blocks = [];
  for (const kind of ['treadmill', 'trainer']) {
    const dev = app.state.devices[kind];
    if (!dev?.connected) continue;
    const st = kind === 'treadmill' ? live.console : live.trainer ?? {};
    const fresh = Date.now() - (dev.state?.updatedAt || 0) < STALE_MS;
    const rows = [...stateRows(kind, st), ...(dev.diagnostics?.() ?? [])];
    const box = document.createElement('div');
    box.className = 'dev-block';
    const h = document.createElement('h3');
    h.textContent = dev.descriptor?.name ?? kind;
    const grid = document.createElement('div');
    grid.className = 'console-grid num';
    for (const [label, text] of rows) {
      const cell = document.createElement('div');
      const l = document.createElement('span');
      l.textContent = label;
      const v = document.createElement('strong');
      v.textContent = fresh && text != null ? String(text) : '—';
      if (label === 'Belt' || (kind === 'trainer' && label === 'Mode')) {
        v.className = 'mode';
        v.dataset.belt = fresh ? st.belt ?? (st.controlled ? 'running' : 'stopped') : '';
        v.dataset.alert = fresh && st.alerts?.length ? 'true' : '';
      }
      cell.append(l, v);
      grid.appendChild(cell);
    }
    box.append(h, grid);
    blocks.push(box);
  }
  if (blocks.length) $('devTables').replaceChildren(...blocks);
  else $('devTables').replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'No device connected.' }));
  // The safety key notice depends on the alerts
  const alerts = (live.console.alerts || []).join(',');
  if (alerts !== lastAlerts) {
    lastAlerts = alerts;
    updateControls();
  }
}

export function renderInfo() {
  const i = live.info;
  const parts = [];
  if (i.firmware) parts.push(`Firmware ${i.firmware}`);
  if (i.serial) parts.push(`Serial ${i.serial}`);
  if (i.reference) parts.push(`Model ${i.reference}`);
  if (i.supported) parts.push(`${i.supported.length} supported fields`);
  if (i.limits?.minKph != null) parts.push(`Speed ${i.limits.minKph}–${i.limits.maxKph} km/h`);
  if (i.limits?.maxIncline != null) parts.push(`Incline ${i.limits.minIncline}–${i.limits.maxIncline} %`);
  $('cInfo').textContent = parts.join(' · ') || 'No equipment info yet.';
}

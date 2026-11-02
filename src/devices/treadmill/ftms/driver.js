/**
 * Any treadmill that speaks Bluetooth FTMS (Fitness Machine Service): reads
 * Treadmill Data, sends target speed and incline through the Control Point,
 * follows the Machine Status. Built on the shared FTMS connection
 * (ftms/connection.js) and the Treadmill base class. Not yet tested on
 * hardware (see #26).
 */
import { Treadmill } from '../treadmill.js';
import { openFtms } from '../../ftms/connection.js';
import {
  SERVICE, TREADMILL_DATA, SPEED_RANGE, INCLINE_RANGE,
  parseTreadmillData, parseSpeedRange, parseInclineRange, setTargetSpeed, setTargetIncline, stopOrPause,
} from './protocol.js';

export class FtmsTreadmill extends Treadmill {
  constructor(events = {}, descriptor = {}) {
    super(events, descriptor);
    this.state = { speed: 0, incline: 0, belt: 'stopped', alerts: [], updatedAt: 0 };
    this.running = false;
    this.features = null;
    this.ftms = null;
  }

  get connected() {
    return this.running && !!this.device?.gatt?.connected;
  }

  get lastResult() {
    return this.ftms?.lastResult ?? null;
  }

  /** opts.device: a Bluetooth device the app already chose. */
  async connect(opts = {}) {
    this.onStatus('connecting');
    this.device = opts.device ?? await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] });
    this.onStatus('initializing');
    this.ftms = await openFtms(this.device, {
      data: { uuid: TREADMILL_DATA, kind: 'treadmill' },
      onData: (v) => this._onData(parseTreadmillData(v)),
      onStatus: (st) => this._onStatus(st),
      onDisconnect: () => this._onDisconnected(),
      onLog: this.onLog,
    });
    this.features = this.ftms.features;
    if (this.features) this.capabilities.incline = this.features.inclineTarget;
    const sr = await this.ftms.read(SPEED_RANGE);
    if (sr) { const r = parseSpeedRange(sr); Object.assign(this.limits, { speedMin: r.min, speedMax: r.max, speedStep: r.step || this.limits.speedStep }); }
    const ir = await this.ftms.read(INCLINE_RANGE);
    if (ir) { const r = parseInclineRange(ir); Object.assign(this.limits, { inclineMin: r.min, inclineMax: r.max, inclineStep: r.step || this.limits.inclineStep }); }
    this.running = true;
    this.info = { name: this.device.name, features: this.features };
    this.onInfo({ ...this.info });
    this.onStatus('ready', this.device.name || 'FTMS');
  }

  disconnect() {
    this.running = false;
    this.ftms?.close();
    this.onStatus('disconnected');
  }

  setSpeed(kmh) { this.ftms?.send(setTargetSpeed(kmh)); }
  setIncline(pct) { this.ftms?.send(setTargetIncline(pct)); }
  pause() { this.ftms?.send(stopOrPause(true)); }
  pauseNow() { this.ftms?.writeNow(stopOrPause(true)); }

  diagnostics() {
    return [
      ['FTMS targets', this.features ? `${this.features.speedTarget ? 'speed' : ''}${this.features.inclineTarget ? ' + incline' : ''}` : '—'],
      ['Last command', this.lastResult ? this.lastResult.text : '—'],
    ];
  }

  // --- internals --------------------------------------------------------------

  _onData(d) {
    const s = this.state;
    Object.assign(s, d);
    if (d.speed != null && s.belt !== 'paused') s.belt = d.speed > 0 ? 'running' : 'stopped';
    if (d.hr != null) { s.hr = d.hr > 0 ? d.hr : null; s.hrSource = d.hr > 0 ? 'console' : null; }
    s.updatedAt = Date.now();
    this.onData({ ...s });
  }

  _onStatus(st) {
    if (st.belt) this.state.belt = st.belt;
    if (st.targetSpeed != null) this.state.targetSpeed = st.targetSpeed;
    if (st.event === 'control-lost') { this.onLog('warn', 'FTMS: another app took control of the treadmill'); this.onControlLost?.(); }
    else this.onLog('info', `FTMS: ${st.event}`);
  }

  _onDisconnected() {
    const was = this.running;
    this.running = false;
    if (was) this.onStatus('disconnected');
  }
}

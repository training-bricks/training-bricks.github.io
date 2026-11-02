/**
 * Any smart trainer that speaks Bluetooth FTMS (Fitness Machine Service):
 * Wahoo KICKR, Elite, Saris, Zwift Hub, recent Tacx… Reads Indoor Bike Data
 * (power, cadence, speed), sends power (ERG), resistance or grade through
 * the Control Point, and follows the Machine Status. Built on the shared
 * FTMS connection (ftms/connection.js) and the Trainer base class, which
 * spreads power changes over a short ramp. Not yet tested on hardware (#7).
 */
import { Trainer } from '../trainer.js';
import { openFtms } from '../../ftms/connection.js';
import {
  SERVICE, INDOOR_BIKE_DATA, POWER_RANGE, RESISTANCE_RANGE,
  parseIndoorBikeData, parsePowerRange, parseResistanceRange,
  setTargetPower, setTargetResistance, setSimulation, startOrResume, stopOrPause,
} from './protocol.js';

export class FtmsTrainer extends Trainer {
  constructor(events = {}, descriptor = {}) {
    super(events, descriptor);
    this.state = { power: 0, cadence: 0, speed: 0, distance: 0, elapsed: 0, mode: 'idle', controlled: false, hr: null, hrSource: null, updatedAt: 0 };
    this.running = false;
    this.features = null;
    this.ftms = null;
    this.resistanceRange = null;
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
      data: { uuid: INDOOR_BIKE_DATA, kind: 'smart trainer' },
      onData: (v) => this._onData(parseIndoorBikeData(v)),
      onStatus: (st) => this._onStatus(st),
      onDisconnect: () => this._onDisconnected(),
      onLog: this.onLog,
    });
    const f = this.features = this.ftms.features;
    if (f) Object.assign(this.capabilities, { erg: f.powerTarget, resistance: f.resistanceTarget, simulation: f.simulationTarget });
    const pr = await this.ftms.read(POWER_RANGE);
    if (pr) { const r = parsePowerRange(pr); Object.assign(this.limits, { powerMin: r.min, powerMax: r.max, powerStep: r.step || this.limits.powerStep }); }
    const rr = await this.ftms.read(RESISTANCE_RANGE);
    if (rr) this.resistanceRange = parseResistanceRange(rr);
    await this.ftms.command(startOrResume());
    this.running = true;
    this.info = { name: this.device.name, features: this.features };
    this.onInfo({ ...this.info });
    this.onStatus('ready', this.device.name || 'FTMS');
  }

  disconnect() {
    this._cancelRamp();
    this.running = false;
    this.ftms?.close();
    this.onStatus('disconnected');
  }

  diagnostics() {
    const f = this.features;
    return [
      ['FTMS targets', f ? ['power', 'resistance', 'simulation'].filter((k) => f[`${k}Target`]).join(' + ') || 'none' : '—'],
      ['Power range', `${this.limits.powerMin ?? '—'}–${this.limits.powerMax ?? '—'} W`],
      ['Last command', this.lastResult ? this.lastResult.text : '—'],
    ];
  }

  // --- Trainer hooks ------------------------------------------------------------

  _applyMode(mode) { this.onLog('info', `FTMS: ${mode} mode`); }
  _sendPower(w) { this.ftms?.send(setTargetPower(w)); }
  /** % of the trainer's range → its resistance level. */
  _sendResistance(pct) {
    const r = this.resistanceRange ?? { min: 0, max: 100 };
    this.ftms?.send(setTargetResistance(r.min + ((r.max - r.min) * pct) / 100));
  }
  _sendSimulation(p) { this.ftms?.send(setSimulation(p)); }
  _sendStop() { this.ftms?.send(stopOrPause(false)); }
  pauseNow() { this._cancelRamp(); this.ftms?.writeNow(stopOrPause(false)); }

  // --- internals --------------------------------------------------------------

  _onData(d) {
    const s = this.state;
    Object.assign(s, d);
    if (d.hr != null) { s.hr = d.hr > 0 ? d.hr : null; s.hrSource = d.hr > 0 ? 'trainer' : null; }
    s.mode = this.mode;
    s.controlled = this.mode !== 'idle';
    s.updatedAt = Date.now();
    this.onData({ ...s });
  }

  _onStatus(st) {
    if (st.event === 'control-lost') { this.onLog('warn', 'FTMS: another app took control of the trainer'); this.onControlLost?.(); }
    else this.onLog('info', `FTMS: ${st.event}${st.targetPower != null ? ` ${st.targetPower} W` : ''}`);
  }

  _onDisconnected() {
    const was = this.running;
    this._cancelRamp();
    this.running = false;
    if (was) this.onStatus('disconnected');
  }
}

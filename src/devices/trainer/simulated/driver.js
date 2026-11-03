/**
 * Smart trainer simulator: same interface as a real one, no Bluetooth.
 * Pedaling is off until simulate({ pedaling: true }) (like the treadmill
 * simulator's console Start). In ERG the power follows the target within a
 * couple of seconds; in resistance or simulation it comes from the level or
 * the grade and the cadence. Speed comes from power on a flat road, HR
 * follows power with a ~20 s lag and RR intervals are simulated like a strap.
 */

import { RrSimulator } from '../../../physiology/hrv.js';
import { sleep, every } from '../../../lib/timer.js';
import { Trainer } from '../trainer.js';

const TICK_MS = 250;
const RIDER_KG = 80;

export class SimulatedTrainer extends Trainer {
  constructor(events = {}, descriptor = {}) {
    super(events, descriptor);
    this.state = { power: 0, cadence: 0, speed: 0, distance: 0, elapsed: 0, mode: 'idle', controlled: false, hr: null, hrSource: null, rr: [], updatedAt: 0 };
    this.running = false;
    this.pedaling = false;
    this.target = { power: 0, resistance: 0, grade: 0 };
    this.simulated = true;
  }

  get connected() {
    return this.running;
  }

  async connect() {
    this.onStatus('connecting');
    await sleep(300);
    this.onStatus('initializing');
    await sleep(500);
    this.running = true;
    this.info = { model: 'Simulated trainer', firmware: 'simulator' };
    this.onInfo({ ...this.info });
    this.onLog('info', 'Trainer simulator ready. Start pedaling from the Debug controls.');
    this.onStatus('ready', 'Trainer simulator');
    this._stopTimer = every(TICK_MS, () => this._tick(TICK_MS / 1000));
  }

  disconnect() {
    this._cancelRamp();
    this._stopTimer?.();
    this.running = false;
    this.onStatus('disconnected');
  }

  /** Debug control: start or stop pedaling, or lose the link as Bluetooth would. */
  simulate({ pedaling, drop } = {}) {
    if (drop) { this.disconnect(); return; }
    if (pedaling != null) this.pedaling = !!pedaling;
    this.onLog('info', this.pedaling ? 'Simulated rider: pedaling' : 'Simulated rider: stopped');
  }

  diagnostics() {
    return [['Target', this.requested.power != null ? `${this.requested.power} W` : '—'], ['Rider', this.pedaling ? 'pedaling' : 'stopped']];
  }

  _applyMode(mode) { this.onLog('tx', `mode ${mode} (sim)`); }
  _sendPower(w) { this.target.power = w; this.onLog('tx', `target power ${w} W (sim)`); }
  _sendResistance(pct) { this.target.resistance = pct; this.onLog('tx', `resistance ${pct} % (sim)`); }
  _sendSimulation(p) { this.target.grade = p.grade; this.onLog('tx', `grade ${p.grade} % (sim)`); }
  _sendStop() { this.target.power = 0; this.onLog('tx', 'stop (sim)'); }

  _tick(dt) {
    const s = this.state;
    const cadenceTarget = this.pedaling ? 85 + Math.random() * 10 : 0;
    s.cadence += (cadenceTarget - s.cadence) * Math.min(1, dt * 2);
    let want = 0;
    if (s.cadence > 20) {
      if (this.mode === 'erg') want = this.target.power;
      else if (this.mode === 'resistance') want = (this.target.resistance / 100) * 6 * s.cadence;
      else if (this.mode === 'simulation') want = Math.max(0, 9.81 * RIDER_KG * (this.target.grade / 100) * Math.max(s.speed, 3) / 3.6 + 1.2 * s.cadence);
      else want = 1.2 * s.cadence; // free pedaling
    }
    s.power += (want - s.power) * Math.min(1, dt * 1.5);
    // Flat road: speed grows with the cube root of power (≈ 30 km/h at 200 W)
    s.speed = s.power > 1 ? 5.1 * Math.cbrt(s.power) : Math.max(0, s.speed - dt * 5);
    s.distance += (s.speed / 3.6) * dt;
    if (s.cadence > 20) s.elapsed += dt;
    // HR follows effort with a ~20 s lag
    const effort = 70 + s.power * 0.35;
    this.hr = (this.hr ?? 70) + (effort - (this.hr ?? 70)) * (dt / 20);
    s.hr = Math.round(this.hr);
    s.hrSource = 'trainer';
    this.rrSim ??= new RrSimulator();
    s.rr = this.rrSim.next(this.hr, dt);
    s.mode = this.mode;
    s.controlled = this.mode !== 'idle';
    s.updatedAt = Date.now();
    this.onData({ ...s, power: Math.round(s.power), cadence: Math.round(s.cadence), distance: Math.round(s.distance), elapsed: Math.floor(s.elapsed) });
  }
}

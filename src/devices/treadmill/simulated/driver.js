/**
 * Simulator: same interface, no Bluetooth. The belt accelerates ~1.5 km/h per
 * second and incline changes 0.5 % per second, like a real treadmill.
 * Starts stopped: use toggleBelt() to mimic the console buttons.
 */

import { RrSimulator } from '../../../physiology/hrv.js';
import { LIMITS, POLL_INTERVAL_MS } from '../nordictrack-exp5i/protocol.js';
import { sleep, every } from '../../../lib/timer.js';
import { normalize, diagnosticsOf } from '../nordictrack-exp5i/messages.js';
import { Treadmill } from '../treadmill.js';


export class SimulatedTreadmill extends Treadmill {
  constructor(events = {}, descriptor = {}) {
    super(events, descriptor);
    this.state = { speed: 0, incline: 0, targetSpeed: 0, mode: 1, distance: 0, time: 0, calories: 0, pulse: null, updatedAt: 0 };
    this.target = { speed: 0, incline: 0 };
    this.belt = false;
    this.running = false;
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
    this.info = { firmware: 'simulator', serial: 'SIM-0001', reference: 0, supported: [0, 1, 4, 9, 10, 12, 16, 20, 21] };
    this.onInfo({ ...this.info });
    this.onLog('info', 'Simulator ready. Use "Console Start/Stop" to move the belt.');
    this.onStatus('ready', 'Simulator');
    this._stopTimer = every(POLL_INTERVAL_MS, () => this._tick(0.2));
  }

  disconnect() {
    this._stopTimer?.();
    this.running = false;
    this.onStatus('disconnected');
  }

  diagnostics() {
    return diagnosticsOf(this.state);
  }

  pause() {
    this.belt = false;
    this.target.speed = 0;
    this.onLog('info', 'Pause mode (sim)');
  }

  pauseNow() {
    this.pause();
  }

  /** Debug control (the device menu): { belt: 'toggle' } presses START/STOP on the console; { drop: true } loses the link as Bluetooth would. */
  simulate({ belt, drop } = {}) {
    if (drop) { this.disconnect(); return; }
    if (belt === 'toggle') this.toggleBelt();
  }

  /** Same as pressing START/STOP on the console. */
  toggleBelt() {
    this.belt = !this.belt;
    if (this.belt && this.target.speed < LIMITS.speedMin) this.target.speed = 3.2;
    if (!this.belt) this.target.speed = 0;
    this.onLog('info', this.belt ? 'Console: START' : 'Console: STOP');
  }

  setSpeed(kmh) {
    if (!this.belt) return this.onLog('warn', `Ignored (belt stopped): speed ${kmh}`);
    this.target.speed = Math.min(LIMITS.speedMax, Math.max(0, Math.round(kmh * 10) / 10));
    if (this.target.speed === 0) this.belt = false;
    this.onLog('tx', `speed ${this.target.speed} km/h (sim)`);
  }

  setIncline(pct) {
    this.target.incline = Math.min(LIMITS.inclineMax, Math.max(0, Math.round(pct * 2) / 2));
    this.onLog('tx', `incline ${this.target.incline}% (sim)`);
  }

  _tick(dt) {
    const approach = (cur, tgt, rate) =>
      Math.abs(tgt - cur) <= rate * dt ? tgt : cur + Math.sign(tgt - cur) * rate * dt;
    const s = this.state;
    s.speed = Math.round(approach(s.speed, this.target.speed, 1.5) * 100) / 100;
    s.incline = Math.round(approach(s.incline, this.target.incline, 0.5) * 100) / 100;
    s.updatedAt = Date.now();
    s.targetSpeed = this.target.speed;
    s.mode = this.belt ? 2 : s.time > 0 ? 3 : 1; // running / paused / idle
    if (this.belt) {
      s.distance += (s.speed / 3.6) * dt;
      s.time += dt;
      s.calories += s.speed * dt * 0.02;
    }
    // Simulated "hand grip" HR: follows effort with a ~20 s lag
    const effort = 70 + s.speed * 9 + s.incline * 3;
    this.hr = (this.hr ?? 70) + (effort - (this.hr ?? 70)) * (dt / 20);
    s.pulse = { bpm: Math.round(this.hr), avg: 0, count: 0, source: 1 };
    // Simulated RR intervals, like a chest strap's
    if (this.belt) {
      this.rrSim ??= new RrSimulator();
      s.rr = this.rrSim.next(this.hr, dt);
    } else {
      s.rr = [];
    }
    Object.assign(s, normalize(s));
    this.onData({ ...s, distance: Math.round(s.distance), time: Math.floor(s.time) });
  }
}

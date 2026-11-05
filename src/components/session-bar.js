/**
 * <bw-session-bar>: the half of the session dashboard Run and Ride share:
 * distance, time, HR and α1, and the session buttons (▶ start, ⏭ skip step,
 * ■ finish, download CSV/FIT/TCX, upload to Intervals.icu). It only draws them;
 * ui/session-screen.js fills the values and wires the buttons. Its parts
 * are found by name in .el (no ids, so both pages can hold one). The export
 * menu's popover id comes from the element's id ("<id>-export").
 */
import { translate } from '../i18n/index.js';

const template = (menuId) => `
  <div class="dash-vals num">
    <span class="dv" data-el="distBox" title="Distance" data-i18n-title="run.distance"><b data-el="dist">0.00</b><small>km</small></span>
    <span class="dv" title="Time" data-i18n-title="run.time"><bw-icon name="time"></bw-icon><b data-el="time">0:00</b></span>
    <span class="dv" data-el="hrBox" title="Heart rate" data-i18n-title="run.heartRate"><bw-icon name="heart"></bw-icon><b data-el="hr">--</b><small data-el="hrSub">bpm</small></span>
    <span class="dv alpha hidden" data-el="alphaBox"><i class="alpha-dot" aria-hidden="true"></i><b data-el="alpha">--</b><small data-el="alphaSub">α1</small></span>
  </div>
  <div class="dash-btns">
    <button class="icon primary" data-el="start" aria-label="Start" title="Start" disabled><bw-icon name="play"></bw-icon></button>
    <button class="icon" data-el="skip" aria-label="Skip step" title="Skip step" disabled data-i18n-label="run.skipStep"><bw-icon name="skip"></bw-icon></button>
    <button class="icon danger" data-el="finish" disabled><bw-icon name="stop"></bw-icon></button>
    <button class="icon" data-el="export" popovertarget="${menuId}" aria-label="Download the session" title="Download (when finished)" disabled data-i18n-title="run.downloadHelp" data-i18n-aria="run.download"><bw-icon name="download"></bw-icon></button>
    <button class="icon" data-el="upload" aria-label="Upload to Intervals.icu" title="Upload to Intervals.icu (when finished)" disabled><bw-icon name="upload"></bw-icon></button>
    <button class="primary hidden" data-el="reconnectDevice"></button>
    <button class="primary hidden" data-el="reconnect" data-i18n="session.reconnectStrap">Reconnect the strap</button>
    <div popover id="${menuId}" class="menu" data-el="menu">
      <button data-el="csv" data-i18n="run.csv">CSV (second by second)</button>
      <button data-el="fit" data-i18n="run.fit">FIT (laps and RR, for Garmin, Strava…)</button>
      <button data-el="tcx" data-i18n="run.tcx">TCX (for Strava, Garmin…)</button>
    </div>
  </div>
  <div class="intensity hidden" data-el="intensityBox">
    <span data-i18n="session.intensity">Workout intensity</span>
    <span class="pm">
      <button class="icon" data-el="intensityDown" aria-label="Lower intensity" title="Lower intensity" data-i18n-label="session.intensityDown">−</button>
      <b class="num" data-el="intensity">100 %</b>
      <button class="icon" data-el="intensityUp" aria-label="Raise intensity" title="Raise intensity" data-i18n-label="session.intensityUp">+</button>
    </span>
  </div>
  <div class="session-feedback hidden" data-el="feedback">
    <label class="field"><span data-i18n="feedback.rpe">How hard (RPE)</span><select data-el="rpe"></select></label>
    <label class="field"><span data-i18n="feedback.feel">How you felt</span><select data-el="feel"></select></label>
  </div>`;

class BwSessionBar extends HTMLElement {
  /** The parts by name: dist, time, hr, hrSub, hrBox, alphaBox, alpha, alphaSub, start, skip, finish, export, upload, menu, csv, fit, tcx, intensityBox, intensity, intensityDown, intensityUp, feedback, rpe, feel. */
  el = {};

  connectedCallback() {
    if (this.firstElementChild) return;
    this.innerHTML = template(`${this.id || 'session'}-export`);
    for (const node of this.querySelectorAll('[data-el]')) this.el[node.dataset.el] = node;
    translate(this);
    document.addEventListener('bw-language', () => translate(this));
  }
}

customElements.define('bw-session-bar', BwSessionBar);

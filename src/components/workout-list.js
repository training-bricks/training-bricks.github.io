import { t } from '../i18n/index.js';
/**
 * <bw-workout-list>: a list of workouts to pick from. Set .entries to items
 * { key, title, sub, hrControl, sport } and notes { note }, in order;
 * .selected marks the chosen key and .disabled locks the list (during a
 * session). One line per workout: sport icon, title and HR tag; sub is the
 * tooltip. A click fires bw-select with detail.key (it bubbles).
 */

const SPORT_ICONS = { run: 'nav.run', ride: 'nav.ride' };

class BwWorkoutList extends HTMLElement {
  #entries = [];
  #selected = null;
  #disabled = false;

  connectedCallback() {
    this.#render();
  }

  set entries(list) {
    this.#entries = list ?? [];
    this.#render();
  }

  set selected(key) {
    this.#selected = key;
    for (const btn of this.querySelectorAll('.witem')) btn.setAttribute('aria-pressed', String(btn.dataset.key === key));
  }

  set disabled(on) {
    this.#disabled = !!on;
    for (const btn of this.querySelectorAll('.witem')) btn.disabled = this.#disabled;
  }

  #render() {
    this.replaceChildren(...this.#entries.map((e) => (e.note != null ? note(e.note) : this.#item(e))));
  }

  #item({ key, title, sub, hrControl = false, sport = null }) {
    const btn = document.createElement('button');
    btn.className = 'witem';
    btn.dataset.key = key;
    btn.disabled = this.#disabled;
    btn.setAttribute('aria-pressed', String(key === this.#selected));
    const strong = document.createElement('strong');
    if (SPORT_ICONS[sport]) {
      const label = t(SPORT_ICONS[sport]);
      const tag = document.createElement('span');
      tag.className = 'sport-icon';
      tag.title = label;
      tag.setAttribute('role', 'img');
      tag.setAttribute('aria-label', label);
      tag.innerHTML = `<bw-icon name="${sport}"></bw-icon>`;
      btn.append(tag);
    }
    strong.textContent = title;
    if (hrControl) {
      const tag = document.createElement('em');
      tag.className = 'hr-tag';
      tag.textContent = '♥ HR';
      tag.title = t(sport === 'ride' ? 'library.hrTagRide' : 'library.hrTag');
      btn.append(strong, tag);
    } else btn.append(strong);
    if (sub) btn.title = sub;
    btn.onclick = () => this.dispatchEvent(new CustomEvent('bw-select', { bubbles: true, detail: { key } }));
    return btn;
  }
}

function note(text) {
  const div = document.createElement('div');
  div.className = 'note';
  div.textContent = text;
  return div;
}

customElements.define('bw-workout-list', BwWorkoutList);

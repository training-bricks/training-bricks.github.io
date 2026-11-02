/**
 * <bw-icon name="refresh"></bw-icon>: a 24×24 stroke icon (class "ico", see
 * css/app.css). Decorative: the button that holds it carries the label.
 */

const ICONS = {
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V20h4.5v-5.5h3V20H18V9.5"/>',
  library: '<rect x="5" y="4.5" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
  run: '<circle cx="15.5" cy="4.5" r="2"/><path d="M14 8.5l-3 5.5M7.5 10.5l3-2.5h3.5l2.5 3.5M11 14l3.5 2.5-1 4.5M11 14l-2.5 4H5"/>',
  ride: '<circle cx="6" cy="16.5" r="3.5"/><circle cx="18" cy="16.5" r="3.5"/><circle cx="14.5" cy="4.5" r="1.5"/><path d="M6 16.5l3.5-6.5h5l3.5 6.5M9.5 10l3 6.5h-6.5M12 7.5l2.5 2.5"/>',
  debug: '<path d="M9 7.5a3 3 0 0 1 6 0"/><rect x="7" y="8.5" width="10" height="12" rx="5"/><path d="M12 10v10M3.5 13H7M17 13h3.5M4.5 8.5L7 10M19.5 8.5L17 10M4.5 19l2.7-1.8M19.5 19l-2.7-1.8"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4v4.5H15"/>',
  signout: '<path d="M14 4.5H6.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H14"/><path d="M10 12h10M16.5 8.5L20 12l-3.5 3.5"/>',
  time: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  play: '<path class="fill" d="M8 5.5v13l10.5-6.5z"/>',
  skip: '<path class="fill" d="M5.5 5.5v13L15 12z"/><path d="M18 5.5v13"/>',
  stop: '<rect class="fill" x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M7.5 18H7a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17.2 9 4.5 4.5 0 0 1 17 18h-.5"/><path d="M12 12.5V20M9 15.5l3-3 3 3"/>',
  incline: '<path d="M3 19h18L21 7z"/><path d="M15 19a4.5 4.5 0 0 0-1.2-3.4"/>',
  pace: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="M12 14l4-5"/><circle cx="12" cy="14" r="1.2"/>',
  power: '<path d="M13 2.5L5.5 13.5H12l-1 8 7.5-11H12z"/>',
  cadence: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="1.5"/><path d="M12 12l4-6.5M16 5.5h2.5"/>',
  warning: '<path d="M10.3 4.2L2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5"/><circle class="fill" cx="12" cy="17" r="1.1"/>',
};

export const ICON_NAMES = Object.keys(ICONS);

class BwIcon extends HTMLElement {
  static observedAttributes = ['name'];

  attributeChangedCallback() {
    const body = ICONS[this.getAttribute('name')] ?? '';
    this.innerHTML = `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  }
}

customElements.define('bw-icon', BwIcon);

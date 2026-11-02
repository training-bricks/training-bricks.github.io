/**
 * Every device driver, by kind. Adding a brand or model = one folder with a
 * driver and its descriptor (index.js) plus one line here. Pure: no
 * Bluetooth access, so it can be tested in Node.
 */
import exp5i from './treadmill/nordictrack-exp5i/index.js';
import ftmsTreadmill from './treadmill/ftms/index.js';
import simulatedTreadmill from './treadmill/simulated/index.js';
import ftmsTrainer from './trainer/ftms/index.js';
import simulatedTrainer from './trainer/simulated/index.js';
import hrStrap from './sensors/hr-strap/index.js';

/** @type {import('./types.js').DriverDescriptor[]} */
export const DRIVERS = [exp5i, ftmsTreadmill, simulatedTreadmill, ftmsTrainer, simulatedTrainer, hrStrap];

export const driversFor = (kind, { debug = false } = {}) => DRIVERS.filter((d) => d.kind === kind && (debug || !d.debugOnly));

export const getDriver = (id) => DRIVERS.find((d) => d.id === id) || null;

/** Options for navigator.bluetooth.requestDevice that find any real driver of a kind. */
export function requestOptions(kind) {
  const filters = [];
  const optional = new Set();
  for (const d of driversFor(kind)) {
    for (const prefix of d.match?.namePrefix || []) filters.push({ namePrefix: prefix });
    for (const s of d.match?.services || []) { filters.push({ services: [s] }); optional.add(s); }
    for (const s of d.match?.optionalServices || []) optional.add(s);
  }
  return { filters, optionalServices: [...optional] };
}

/**
 * The driver for a chosen device of a kind: by name prefix, else the generic
 * (standard-protocol) driver of the kind, else the only real one. Null when
 * it cannot tell.
 */
export function detect(kind, { name = '' } = {}) {
  const real = driversFor(kind);
  const byName = real.find((d) => d.match?.namePrefix?.some((p) => name.startsWith(p)));
  if (byName) return byName;
  return real.find((d) => d.generic) ?? (real.length === 1 ? real[0] : null);
}

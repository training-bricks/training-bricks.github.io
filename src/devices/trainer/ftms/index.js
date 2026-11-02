/** Smart trainers over Bluetooth FTMS: the generic trainer driver (any brand that implements the standard). */
import { FtmsTrainer } from './driver.js';

/** @type {import('../../types.js').DriverDescriptor} */
const descriptor = {
  id: 'ftms-trainer',
  kind: 'trainer',
  name: 'Smart trainer (Bluetooth FTMS)',
  match: { services: ['fitness_machine'] },
  generic: true,
  capabilities: { erg: true, resistance: true, simulation: true, cadence: true, speed: true },
  // Until the trainer reports its Supported Power Range
  limits: { powerMin: 0, powerMax: 2000, powerStep: 1, resistanceMin: 0, resistanceMax: 100, gradeMin: -20, gradeMax: 20 },
  create: (events) => new FtmsTrainer(events, descriptor),
};

export default descriptor;

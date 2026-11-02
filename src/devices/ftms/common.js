/**
 * What every Bluetooth FTMS machine shares (Fitness Machine Service 1.0):
 * the Feature characteristic, the Control Point commands and answers, and
 * the Machine Status. Treadmills (treadmill/ftms) and smart trainers
 * (trainer/ftms) add their own data characteristic and targets. Pure:
 * tested with byte layouts from the specification. Little-endian throughout.
 */

export const SERVICE = 'fitness_machine';
export const FEATURE = 0x2acc;
export const CONTROL_POINT = 0x2ad9;
export const MACHINE_STATUS = 0x2ada;

/** Fitness Machine Feature (0x2ACC): what it reports and which targets it accepts. */
export function parseFeatures(v) {
  const machine = v.getUint32(0, true);
  const targets = v.byteLength >= 8 ? v.getUint32(4, true) : 0;
  return {
    machine,
    targets,
    cadenceReported: !!(machine & (1 << 1)),
    inclineReported: !!(machine & (1 << 3)),
    resistanceReported: !!(machine & (1 << 7)),
    hrReported: !!(machine & (1 << 10)),
    powerReported: !!(machine & (1 << 14)),
    speedTarget: !!(targets & (1 << 0)),
    inclineTarget: !!(targets & (1 << 1)),
    resistanceTarget: !!(targets & (1 << 2)),
    powerTarget: !!(targets & (1 << 3)),
    simulationTarget: !!(targets & (1 << 13)),
  };
}

export const bytes = (...b) => Uint8Array.from(b);
export const le16 = (x) => [x & 0xff, (x >> 8) & 0xff];

export const OP = {
  REQUEST_CONTROL: 0x00, RESET: 0x01, SPEED: 0x02, INCLINE: 0x03, RESISTANCE: 0x04, POWER: 0x05,
  START: 0x07, STOP_PAUSE: 0x08, SIMULATION: 0x11, RESPONSE: 0x80,
};
export const requestControl = () => bytes(OP.REQUEST_CONTROL);
export const startOrResume = () => bytes(OP.START);
export const stopOrPause = (pause = true) => bytes(OP.STOP_PAUSE, pause ? 2 : 1);

const RESULTS = { 1: 'success', 2: 'not supported', 3: 'invalid parameter', 4: 'failed', 5: 'control not permitted' };

/** Control Point indication: [0x80, request opcode, result]. */
export function parseControlResponse(v) {
  if (v.getUint8(0) !== OP.RESPONSE) return null;
  const result = v.getUint8(2);
  return { opcode: v.getUint8(1), result, ok: result === 1, text: RESULTS[result] ?? `code ${result}` };
}

/** Fitness Machine Status (0x2ADA): what changed on the machine itself. */
export function parseMachineStatus(v) {
  const op = v.getUint8(0);
  switch (op) {
    case 0x01: return { event: 'reset' };
    case 0x02: return { event: 'stopped', belt: v.byteLength > 1 && v.getUint8(1) === 2 ? 'paused' : 'stopped' };
    case 0x03: return { event: 'stopped', belt: 'stopped' };   // stopped by safety key
    case 0x04: return { event: 'started', belt: 'running' };
    case 0x05: return { event: 'target-speed', targetSpeed: v.getUint16(1, true) / 100 };
    case 0x06: return { event: 'target-incline', targetIncline: v.getInt16(1, true) / 10 };
    case 0x07: return { event: 'target-resistance', targetResistance: v.getUint8(1) / 10 };
    case 0x08: return { event: 'target-power', targetPower: v.getInt16(1, true) };
    case 0x12: return { event: 'simulation', windSpeed: v.getInt16(1, true) / 1000, grade: v.getInt16(3, true) / 100 };
    case 0xff: return { event: 'control-lost' };
    default: return { event: `status ${op}` };
  }
}

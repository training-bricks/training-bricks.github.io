/**
 * Bluetooth Fitness Machine Service (FTMS 1.0) for smart trainers (indoor
 * bikes): parsing Indoor Bike Data and the supported ranges, and building
 * the bike targets (power for ERG, resistance, grade simulation). What every
 * FTMS machine shares is in ftms/common.js and re-exported here. Pure:
 * tested with byte layouts from the specification. Little-endian throughout.
 */
import { OP, bytes, le16 } from '../../ftms/common.js';

export {
  SERVICE, FEATURE, CONTROL_POINT, MACHINE_STATUS, OP, parseFeatures, requestControl, startOrResume, stopOrPause,
  parseControlResponse, parseMachineStatus,
} from '../../ftms/common.js';

export const INDOOR_BIKE_DATA = 0x2ad2;
export const RESISTANCE_RANGE = 0x2ad6;
export const POWER_RANGE = 0x2ad8;

/** Indoor Bike Data (0x2AD2): the fields the flags say are present, in spec order. */
export function parseIndoorBikeData(v) {
  const flags = v.getUint16(0, true);
  let o = 2;
  const out = {};
  const u8 = () => v.getUint8(o++);
  const u16 = () => { const x = v.getUint16(o, true); o += 2; return x; };
  const s16 = () => { const x = v.getInt16(o, true); o += 2; return x; };
  const u24 = () => { const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); o += 3; return x; };
  if (!(flags & 0x0001)) out.speed = u16() / 100;            // bit 0 "more data" = 0: instantaneous speed present (km/h)
  if (flags & 0x0002) out.averageSpeed = u16() / 100;
  if (flags & 0x0004) out.cadence = u16() / 2;               // rpm, 0.5 resolution
  if (flags & 0x0008) out.averageCadence = u16() / 2;
  if (flags & 0x0010) out.distance = u24();                  // m
  if (flags & 0x0020) out.resistance = s16();                // unitless level
  if (flags & 0x0040) out.power = s16();                     // W
  if (flags & 0x0080) out.averagePower = s16();
  if (flags & 0x0100) { out.calories = u16(); out.caloriesPerHour = u16(); out.caloriesPerMinute = u8(); }
  if (flags & 0x0200) out.hr = u8();
  if (flags & 0x0400) out.met = u8() / 10;
  if (flags & 0x0800) out.time = u16();                      // elapsed s
  if (flags & 0x1000) out.remaining = u16();
  return out;
}

/** Supported Power Range (0x2AD8), W. */
export const parsePowerRange = (v) => ({ min: v.getInt16(0, true), max: v.getInt16(2, true), step: v.getUint16(4, true) });

/** Supported Resistance Level Range (0x2AD6), unitless level (0.1 resolution). */
export const parseResistanceRange = (v) => ({ min: v.getInt16(0, true) / 10, max: v.getInt16(2, true) / 10, step: v.getUint16(4, true) / 10 });

/** ERG: Set Target Power (0x05), sint16 W. */
export const setTargetPower = (w) => bytes(OP.POWER, ...le16(Math.round(w) & 0xffff));

/** Set Target Resistance Level (0x04), uint8 with 0.1 resolution. */
export const setTargetResistance = (level) => bytes(OP.RESISTANCE, Math.max(0, Math.min(255, Math.round(level * 10))));

/**
 * Set Indoor Bike Simulation Parameters (0x11): wind speed (m/s, 0.001),
 * grade (%, 0.01), rolling resistance (0.0001) and wind resistance (kg/m, 0.01).
 */
export const setSimulation = ({ windSpeed = 0, grade = 0, crr = 0.004, cw = 0.51 } = {}) => bytes(
  OP.SIMULATION,
  ...le16(Math.round(windSpeed * 1000) & 0xffff),
  ...le16(Math.round(grade * 100) & 0xffff),
  Math.round(crr * 10000) & 0xff,
  Math.round(cw * 100) & 0xff,
);

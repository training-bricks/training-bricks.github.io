/**
 * Bluetooth Fitness Machine Service (FTMS 1.0) for treadmills: parsing what
 * the treadmill reports and building its targets. What every FTMS machine
 * shares (features, Control Point, Machine Status) is in ftms/common.js and
 * re-exported here. Pure: tested with byte layouts from the specification.
 */
import { OP, bytes, le16 } from '../../ftms/common.js';

export {
  SERVICE, FEATURE, CONTROL_POINT, MACHINE_STATUS, OP, parseFeatures, requestControl, startOrResume, stopOrPause,
  parseControlResponse, parseMachineStatus,
} from '../../ftms/common.js';

export const TREADMILL_DATA = 0x2acd;
export const SPEED_RANGE = 0x2ad4;
export const INCLINE_RANGE = 0x2ad5;

/** Treadmill Data (0x2ACD): the fields the flags say are present, in spec order. */
export function parseTreadmillData(v) {
  const flags = v.getUint16(0, true);
  let o = 2;
  const out = {};
  const u8 = () => v.getUint8(o++);
  const u16 = () => { const x = v.getUint16(o, true); o += 2; return x; };
  const s16 = () => { const x = v.getInt16(o, true); o += 2; return x; };
  const u24 = () => { const x = v.getUint8(o) | (v.getUint8(o + 1) << 8) | (v.getUint8(o + 2) << 16); o += 3; return x; };
  if (!(flags & 0x0001)) out.speed = u16() / 100;            // bit 0 "more data" = 0: instantaneous speed present
  if (flags & 0x0002) out.averageSpeed = u16() / 100;
  if (flags & 0x0004) out.distance = u24();                  // m
  if (flags & 0x0008) { out.incline = s16() / 10; out.rampAngle = s16() / 10; }
  if (flags & 0x0010) { out.elevationGain = u16() / 10; out.elevationLoss = u16() / 10; }
  if (flags & 0x0020) out.pace = u8() / 10;                  // km/min
  if (flags & 0x0040) out.averagePace = u8() / 10;
  if (flags & 0x0080) { out.calories = u16(); out.caloriesPerHour = u16(); out.caloriesPerMinute = u8(); }
  if (flags & 0x0100) out.hr = u8();
  if (flags & 0x0200) out.met = u8() / 10;
  if (flags & 0x0400) out.time = u16();                      // elapsed s
  if (flags & 0x0800) out.remaining = u16();
  if (flags & 0x1000) { out.force = s16(); out.power = s16(); }
  return out;
}

/** Supported Speed Range (0x2AD4), km/h. */
export const parseSpeedRange = (v) => ({ min: v.getUint16(0, true) / 100, max: v.getUint16(2, true) / 100, step: v.getUint16(4, true) / 100 });

/** Supported Inclination Range (0x2AD5), %. */
export const parseInclineRange = (v) => ({ min: v.getInt16(0, true) / 10, max: v.getInt16(2, true) / 10, step: v.getUint16(4, true) / 10 });

export const setTargetSpeed = (kmh) => bytes(OP.SPEED, ...le16(Math.round(kmh * 100)));
export const setTargetIncline = (pct) => bytes(OP.INCLINE, ...le16(Math.round(pct * 10) & 0xffff));

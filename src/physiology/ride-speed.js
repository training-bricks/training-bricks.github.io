/**
 * Virtual speed of a ride: the steady speed the watts would hold on a flat
 * road, without wind. A smart trainer in ERG reports its flywheel speed,
 * which follows cadence, not power (2026-11-05 on a KICKR CORE: 21 km/h at
 * 197 W, at 120 W and at 116 W alike), so distance meant nothing.
 * P · (1 − loss) = v · (m · g · Crr + ½ · ρ · CdA · v²), solved for v.
 */
export const RIDER_KG_DEFAULT = 75;
const BIKE_KG = 9;
const G = 9.81;
const CRR = 0.004;        // road tyres on smooth asphalt
const CDA = 0.32;         // m², hands on the hoods
const RHO = 1.2;          // kg/m³, air at sea level and 20 °C
const LOSS = 0.025;       // drivetrain

/** km/h for `watts` and a rider of `riderKg` (0 when not pushing). */
export function flatSpeed(watts, riderKg = RIDER_KG_DEFAULT) {
  if (!(watts > 0)) return 0;
  const p = watts * (1 - LOSS);
  const roll = ((riderKg > 0 ? riderKg : RIDER_KG_DEFAULT) + BIKE_KG) * G * CRR;
  const air = 0.5 * RHO * CDA;
  // power(v) = roll·v + air·v³ grows with v: bisection on 0–30 m/s (108 km/h)
  let lo = 0;
  let hi = 30;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    if (roll * v + air * v ** 3 < p) lo = v;
    else hi = v;
  }
  return Math.round(lo * 3.6 * 100) / 100;
}

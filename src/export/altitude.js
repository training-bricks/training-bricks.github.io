/**
 * Altitude climbed so far at each sample (distance × incline), so Garmin and
 * Intervals.icu show the ascent of a treadmill run. Null without an incline
 * (a ride). samples: [{ distance: m, incline?: % }]
 */
export function climbedMeters(samples) {
  if (!samples.some((s) => s.incline != null)) return null;
  let altitude = 0;
  return samples.map((s, i) => {
    if (i) altitude += Math.max(0, s.distance - samples[i - 1].distance) * ((s.incline ?? 0) / 100);
    return altitude;
  });
}

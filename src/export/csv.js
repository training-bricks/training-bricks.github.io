import { formatPace } from '../workouts/steps.js';

/** A text field: quoted when it holds a comma or a quote. */
const text = (v) => (v == null ? '' : /[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/**
 * CSV of the session samples (the chart's table view). Ride samples have no
 * pace, incline nor target speed (empty) and fill the power columns. The control
 * columns tell what the HR control did (#10): the step, the HR range it
 * followed, what HR added or removed (km/h on a run, W on a ride), and the
 * reason on the second the target changed. The last column is the workout
 * intensity then (#39).
 */
export function samplesToCsv(samples) {
  const head = 'time_s,speed_kmh,pace_min_km,target_kmh,incline_pct,hr_bpm,distance_m,alpha1,rr_ms,step,hr_lo,hr_hi,hr_adjust,reason,power_w,cadence_rpm,target_w,intensity_pct';
  const rows = samples.map((s) => {
    const ride = s.power !== undefined || s.cadence !== undefined;
    return [
      Math.round(s.elapsed), (s.speed ?? 0).toFixed(2), ride ? '' : formatPace(s.speed), ride ? '' : s.target ?? '',
      s.incline != null ? s.incline.toFixed(1) : '', s.hr ?? '', (s.distance ?? 0).toFixed(1),
      s.alpha1 ?? '', (s.rr || []).join(';'), // that second's RRs, separated by ;
      s.step ?? '', s.hrLo ?? '', s.hrHi ?? '', s.hrAdjust != null ? s.hrAdjust.toFixed(ride ? 0 : 1) : '', text(s.reason),
      s.power ?? '', s.cadence ?? '', ride ? s.target ?? '' : '', s.intensity ?? '',
    ].join(',');
  });
  return [head, ...rows].join('\n');
}

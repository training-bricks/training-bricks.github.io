/**
 * Facts about a workout that the lists and the selection need, without the
 * DOM: its approximate length and whether HR can steer it.
 */
import { flattenWorkout, followsHr } from './steps.js';
import { resolveDoc } from '../physiology/zones.js';

/** Approximate total duration of a workout_doc (s), repeats included. */
export function workoutSeconds(doc) {
  const walk = (steps) => steps.reduce((a, s) => a + (s.steps ? (s.reps || 1) * walk(s.steps) : s.duration || 0), 0);
  return walk(doc?.steps || []);
}

/**
 * Whether HR can steer a workout: library workouts say so (hrControl), the
 * Intervals.icu ones are judged by their steps (speed on foot, watts on a bike).
 */
export function hrControllable(w, zones) {
  if (w.hrControl != null) return w.hrControl;
  return followsHr(flattenWorkout(resolveDoc(w.workout_doc, zones, w.sport), { zones }));
}

// Session export
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTcx } from '../src/export/tcx.js';

test('buildTcx', () => {
  const t0 = Date.UTC(2026, 9, 25, 12, 0, 0);
  const samples = Array.from({ length: 61 }, (_, i) => ({ t: t0 + i * 1000, distance: i * 2.5, speed: 9, hr: i ? 140 : null }));
  const tcx = buildTcx(samples, { name: 'Test <A&B>' });
  assert.match(tcx, /<Activity Sport="Running">/);
  assert.match(tcx, /<TotalTimeSeconds>60<\/TotalTimeSeconds>/);
  assert.match(tcx, /<DistanceMeters>150\.0<\/DistanceMeters>/);
  assert.match(tcx, /<AverageHeartRateBpm><Value>140<\/Value>/);
  assert.match(tcx, /Test &lt;A&amp;B&gt;/);
  assert.equal((tcx.match(/<Trackpoint>/g) || []).length, 61);
  assert.throws(() => buildTcx([]));
});

test('buildTcx: altitude from the incline, so the ascent shows on Garmin and Intervals.icu', () => {
  const t0 = Date.UTC(2026, 9, 30, 19, 46, 0);
  const samples = Array.from({ length: 101 }, (_, i) => ({ t: t0 + i * 1000, distance: i * 2, speed: 7.2, hr: 130, incline: 2 }));
  const tcx = buildTcx(samples);
  const alts = [...tcx.matchAll(/<AltitudeMeters>([\d.]+)<\/AltitudeMeters>/g)].map((m) => Number(m[1]));
  assert.equal(alts.length, 101);
  assert.equal(alts[0], 0);
  assert.equal(alts.at(-1), 4); // 200 m at 2 %
  // Schema order inside a Trackpoint: Time, AltitudeMeters, DistanceMeters
  assert.match(tcx, /<Time>[^<]+<\/Time><AltitudeMeters>[\d.]+<\/AltitudeMeters><DistanceMeters>/);
  // Without incline (a ride) no altitude is written
  assert.doesNotMatch(buildTcx(samples.map(({ incline, ...s }) => s)), /AltitudeMeters/);
});

test('buildTcx: a ride is Biking, with cadence and watts on every point and the lap cadence', () => {
  const t0 = Date.UTC(2026, 10, 1, 9, 0, 0);
  const samples = Array.from({ length: 61 }, (_, i) => ({ t: t0 + i * 1000, distance: i * 8, speed: 28.8, hr: 130, power: 150 + i, cadence: i % 2 ? 90 : 92 }));
  const tcx = buildTcx(samples, { name: 'Z2 ride', sport: 'ride' });
  assert.match(tcx, /<Activity Sport="Biking">/);
  assert.equal((tcx.match(/<ns3:Watts>\d+<\/ns3:Watts>/g) || []).length, 61);
  assert.match(tcx, /<HeartRateBpm><Value>130<\/Value><\/HeartRateBpm><Cadence>92<\/Cadence><Extensions><ns3:TPX><ns3:Speed>8\.000<\/ns3:Speed><ns3:Watts>150<\/ns3:Watts>/);
  assert.match(tcx, /<Intensity>Active<\/Intensity>\n<Cadence>91<\/Cadence>\n<TriggerMethod>/);
  assert.doesNotMatch(tcx, /AltitudeMeters/);
  // A run keeps its shape: Running, no cadence nor watts
  const run = buildTcx(samples.map(({ power, cadence, ...s }) => ({ ...s, incline: 1 })));
  assert.match(run, /<Activity Sport="Running">/);
  assert.doesNotMatch(run, /Watts|Cadence/);
});

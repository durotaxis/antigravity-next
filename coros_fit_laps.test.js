const { normalizeFitLaps } = require('./coros_fit_importer');

test('reads FIT lap records without recomputing kilometer boundaries', () => {
  const laps = normalizeFitLaps([
    { totalDistance: 1000, totalTimerTime: 400, avgSpeed: 2.5, avgCadence: 82, avgHeartRate: 122 },
    { totalDistance: 1000, totalTimerTime: 380, enhancedAvgSpeed: 2.63, avgCadence: 164, avgHeartRate: 131 },
    { totalDistance: 372, totalTimerTime: 174, avgHeartRate: 124 }
  ]);
  expect(laps).toHaveLength(3);
  expect(laps.map(lap => lap.distanceLabel)).toEqual([
    '0.00-1.00 km', '1.00-2.00 km', '2.00-2.37 km'
  ]);
  expect(laps[0]).toEqual(expect.objectContaining({
    lapLabel: '1', distanceMeters: 1000, elapsedSeconds: 400,
    avgSpeed: 9, avgPitch: 164, avgHr: 122, avgStride: 91.5
  }));
  expect(laps[1].avgSpeed).toBe(9.5);
  expect(laps[2].avgPitch).toBe(0);
  expect(laps[2].avgStride).toBe(0);
});

test('does not invent laps when the FIT has none', () => {
  expect(normalizeFitLaps(undefined)).toEqual([]);
  expect(normalizeFitLaps([])).toEqual([]);
});

test('preserves a non-kilometer manual lap as recorded', () => {
  const rows = normalizeFitLaps([{ totalDistance: 500, totalElapsedTime: 210, avgHeartRate: 120 }]);
  expect(rows).toHaveLength(1);
  expect(rows[0].distanceLabel).toBe('0.00-0.50 km');
  expect(rows[0].elapsedSeconds).toBe(210);
  expect(rows[0].avgSpeed).toBe(8.6);
});

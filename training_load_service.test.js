const { extractCompleteRestWindows } = require('./training_load_service');

function point(second, speedMps, cadence, heartRate = null) {
  return { timestampMs: second * 1000, speedMps, cadence, heartRate };
}

describe('training_load_service', () => {
  test('returns only qualified complete-rest time windows', () => {
    const points = [];
    for (let second = 0; second < 12; second += 1) points.push(point(second, 0, 0, 154 - second));
    points.push(point(12, 4, 80));
    for (let second = 13; second < 24; second += 1) points.push(point(second, 0.5, 0));

    expect(extractCompleteRestWindows(points)).toEqual([
      { startTimestampMs: 0, endTimestampMs: 12000, durationSeconds: 12, startHeartRate: 154, endHeartRate: 143, heartRateChange: -11 },
      { startTimestampMs: 13000, endTimestampMs: 24000, durationSeconds: 11, startHeartRate: null, endHeartRate: null, heartRateChange: null }
    ]);
  });

  test('ignores short stops and missing motion sensors', () => {
    const shortStop = Array.from({ length: 6 }, (_, second) => point(second, 0, 0));
    const missing = Array.from({ length: 15 }, (_, second) => point(second, null, null));
    expect(extractCompleteRestWindows(shortStop)).toEqual([]);
    expect(extractCompleteRestWindows(missing)).toEqual([]);
  });
});

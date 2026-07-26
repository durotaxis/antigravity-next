const { aggregateRecordsByMinute, buildRouteData, normalizeRecord, parseJsonText } = require('./coros_fit_importer');

describe('COROS FIT minute aggregation', () => {
  test('accepts metadata JSON with a UTF-8 BOM', () => {
    expect(parseJsonText('\uFEFF{"source":"coros_fit","labelId":"479174757189713922"}')).toEqual({
      source: 'coros_fit',
      labelId: '479174757189713922'
    });
  });

  test('converts FIT units and semicircles', () => {
    const row = normalizeRecord({ timestamp: new Date('2026-07-21T09:00:00Z'), distance: 10, enhancedSpeed: 2, cadence: 80, enhancedAltitude: 12, positionLat: 2 ** 30, positionLong: -(2 ** 30) });
    expect(row.speedKmh).toBe(7.2);
    expect(row.latitude).toBe(90);
    expect(row.longitude).toBe(-90);
  });

  test('doubles half cadence and applies the TCX minute correction rule', () => {
    const result = aggregateRecordsByMinute([
      { timestamp: new Date('2026-07-21T09:00:00Z'), distance: 0, enhancedSpeed: 2, heartRate: 120, cadence: 80, enhancedAltitude: 10 },
      { timestamp: new Date('2026-07-21T09:00:01Z'), distance: 2, enhancedSpeed: 2, heartRate: 122, cadence: 82, enhancedAltitude: 12 }
    ]);
    expect(result.cadenceMultiplier).toBe(2);
    expect(result.chartData[0]).toMatchObject({
      time: '18:00', rawDistance: 2, rawSpeed: 7.2, distance: 4, stride: 2.5,
      speed: 7.2, heartRate: 121, pitch: 162, altitude: 11,
      distanceSource: 'speed-adjusted', speedSource: 'distance-adjusted'
    });
  });

  test('builds second-level RUN VIDEO route data from FIT GPS records', () => {
    const route = buildRouteData([
      { timestamp: new Date('2026-07-22T13:00:00Z'), distance: 0, enhancedSpeed: 2, heartRate: 120, cadence: 80, enhancedAltitude: 10, positionLat: 2 ** 29, positionLong: 2 ** 28 },
      { timestamp: new Date('2026-07-22T13:00:01Z'), distance: 2, enhancedSpeed: 2.1, heartRate: 121, cadence: 81, enhancedAltitude: 11, positionLat: (2 ** 29) + 100, positionLong: (2 ** 28) + 100 }
    ], '479084460877316198');
    expect(route).toMatchObject({ source: 'coros_fit', runId: '479084460877316198', durationSeconds: 1 });
    expect(route.points).toHaveLength(2);
    expect(route.points[1]).toMatchObject({ elapsedSeconds: 1, distanceMeters: 2, speed: 7.56, heartRate: 121, pitch: 162, altitudeMeters: 11 });
  });
});

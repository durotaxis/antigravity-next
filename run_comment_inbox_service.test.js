const service = require('./run_comment_inbox_service');

describe('Run Comment inbox payload validation', () => {
  test('accepts a COROS activity message', () => {
    expect(service.validatePayload({ date: '2026-07-21', activityId: '479058301298966730' }, 'run_479058301298966730.json')).toEqual({
      date: '2026-07-21', activityId: '479058301298966730'
    });
  });

  test('rejects a filename that does not match activityId', () => {
    expect(() => service.validatePayload({ date: '2026-07-21', activityId: 'abc', message: 'comment' }, 'run_other.json')).toThrow('Filename must be run_abc.json');
  });

  test('maps COROS summary fields into a new run card', () => {
    expect(service.buildDailySummary({
      date: '2026-07-21', durationSeconds: 3331, distanceKm: 5.93,
      averageHeartRate: 138, calories: 411,
      activityDetails: { averageCadenceSpm: 142, averageStrideLengthM: 0.75 }
    }, '最新のRun Comment')).toEqual({
      date: '2026-07-21', step_count: 7883, total_distance_km: 5.93,
      total_time: '00:55:31', calories_kcal: 411, avg_stride: 75,
      hr_avg: 138, avg_cadence: 142, avg_speed: 6.4, message: '最新のRun Comment'
    });
  });
});

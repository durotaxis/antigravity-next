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
test('a completed inbox import carries the persisted comment into the notification event', async () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const { completedImports } = require('./coros_import_completions');
  const message = '1分毎テーブル所見: 保存済みの所見';
  const mockFs = { mkdir: jest.fn(), readdir: async () => ['run_123.json'], rename: jest.fn(),
    unlink: jest.fn(), writeFile: jest.fn(), readFile: async file => {
      if (file.endsWith('run_123.json')) return JSON.stringify({ date: '2026-11-03', activityId: '123' });
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    } };
  const sandbox = { __dirname, module: { exports: {} }, require(name) {
    if (name === 'fs') return { promises: mockFs };
    if (name === './gemini_service') return { generateCorosRunComment: async () => ({ message }) };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('./run_comment_inbox_service'), 'utf8'), sandbox);
  const repo = { getRunMessage: jest.fn(), getDailySummary: jest.fn(), saveRunMessage: jest.fn(), saveDailySummary: jest.fn() };
  const result = await sandbox.module.exports.scanInbox(repo);
  expect(result.failed).toEqual([]);
  expect(repo.saveRunMessage).toHaveBeenCalledWith(expect.objectContaining({ run_id: '123', message }));
  expect(completedImports({ imported: [] }, result)[0]).toMatchObject({ runId: '123', message });
});

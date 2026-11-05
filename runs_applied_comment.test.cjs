const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./index'), 'utf8');
const route = source.slice(source.indexOf("app.get('/api/runs',"), source.indexOf("app.delete('/api/runs/:id',"));
for (const includeDerived of [false, true]) test('APPLY list selection derived=' + includeDerived, async () => {
  let handler, applied = 'second run selected by APPLY';
  const original = { id: 259, date: '2026-11-03', step_count: 1000, total_distance_km: 4.99, total_time: '00:47:15', message: 'first run generated later', images: [] };
  vm.runInNewContext(route, {
    app: { get: (_, fn) => { handler = fn; } }, process: { env: {} }, console,
    repo: { getAllRuns: async () => [original], getDailySummary: async () => ({ message: applied }) },
    syncDailySummaryFromTcx: async () => ({ summary: null }),
    syncDailySummaryFromCache: mock.fn(),
    computeDerivedFromIntradayCache: async () => null
  });
  const res = { json: mock.fn(), status: mock.fn(function () { return this; }) };
  const req = { protocol: 'http', get: () => 'localhost', query: { includeDerived: includeDerived ? '1' : '0' } };
  await handler(req, res);
  assert.equal(res.status.mock.calls.length, 0);
  assert.equal(res.json.mock.calls[0].arguments[0][0].message, applied);
  assert.equal(res.json.mock.calls[0].arguments[0][0].total_distance_km, 4.99);
  applied = 'first run selected by APPLY';
  await handler(req, res);
  assert.equal(res.json.mock.calls[1].arguments[0][0].message, applied);
  applied = '';
  await handler(req, res);
  assert.equal(res.json.mock.calls[2].arguments[0][0].message, '');
  assert.equal(original.message, 'first run generated later');
});

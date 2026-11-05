const fs = require('node:fs');
const vm = require('node:vm');

// Exercise the registered handler with a fake repository and Gemini generator.
const source = fs.readFileSync(require.resolve('./index'), 'utf8');
const route = source.slice(source.indexOf("app.post('/api/advice/gemini',"), source.indexOf("app.post('/api/advice/gemini/chart',"));
const classifier = source.slice(source.indexOf('function isTemporaryRunMessage'), source.indexOf('async function generateTcxRunMessage'));
test.each(['tcx', 'coros_fit'])('%s uses the selected run and calls Gemini only once across two requests', async source => {
  const db = new Map();
  const date = '2026-11-03', runId = source === 'tcx' ? date + '_132900' : '123';
  db.set(runId, { message: source === 'tcx' ? 'No API Key' : 'AI Analysis is currently unavailable.' });
  db.set('other', { message: 'other run' });
  const repo = { getRunMessage: async (_, id) => db.get(id),
    saveRunMessage: async row => db.set(row.run_id, row), saveDailySummary: jest.fn() };
  const generate = jest.fn(async () => 'saved guide');
  let handler;
  vm.runInNewContext(classifier + route, { app: { post: (_, fn) => { handler = fn; } }, repo,
    getCorosFitIntradayPath: () => 'fit', fs: { readFile: async () => JSON.stringify({ source, labelId: runId, chartData: [{}] }) },
    readTcxMinuteRunCache: async () => [{}], generateTcxRunMessage: generate, GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE: '現在利用が制限されています。しばらくお待ちください。' });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  for (let i = 0; i < 2; i++) await handler({ body: { date, runId, source } }, res);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({ advice: 'saved guide' }));
  expect(generate).toHaveBeenCalledTimes(1);
  expect(repo.saveDailySummary).toHaveBeenCalledTimes(1);
  expect(db.get('other').message).toBe('other run');
});

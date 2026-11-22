const fs = require('node:fs');
const vm = require('node:vm');

const frontend = fs.readFileSync(require.resolve('./public/script.js'), 'utf8');
const applyFunction = frontend.slice(
  frontend.indexOf('async function applySelectedRunAdviceFromCurrentView()'),
  frontend.indexOf('\nfunction renderSummary(', frontend.indexOf('async function applySelectedRunAdviceFromCurrentView()'))
);
const backend = fs.readFileSync(require.resolve('./index.js'), 'utf8');
const applyRoute = backend.slice(
  backend.indexOf("app.post('/api/run-comment/apply',"),
  backend.indexOf("app.post('/api/run-comment/import-inbox',")
);

test.each([
  ['tcx', '2026-11-22_090000'],
  ['coros_fit', '481915529901146116']
])('%s APPLY sends the new visible Run Comment without requiring it to be saved first', async (source, runId) => {
  const text = { textContent: 'new weather-aware Run Comment' };
  const button = { textContent: 'Apply', disabled: false };
  const fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
  const context = {
    currentAdviceRunDate: '2026-11-22', currentRunChartSource: source,
    getSelectedActiveRun: () => ({ runId }),
    getSelectedAdviceRunId: () => runId,
    document: { getElementById: id => id === 'daily-message-text' ? text : id === 'refreshTcxAdviceBtn' ? button : null },
    isTemporaryUnavailableMessage: () => false,
    fetch, alert: jest.fn()
  };
  vm.runInNewContext(applyFunction, context);
  await context.applySelectedRunAdviceFromCurrentView();
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('/api/run-comment/apply');
  expect(options.method).toBe('POST');
  expect(JSON.parse(options.body)).toEqual({
    date: '2026-11-22', runId, source, message: text.textContent
  });
  expect(button.disabled).toBe(false);
  expect(button.textContent).toBe('Apply');
  expect(context.alert).not.toHaveBeenCalled();
});

function routeSetup() {
  const applyRunComment = jest.fn(async () => ({ date: '2026-11-22' }));
  let handler;
  vm.runInNewContext(applyRoute, {
    app: { post: (name, callback) => { if (name === '/api/run-comment/apply') handler = callback; } },
    normalizeRunDate: value => value,
    sanitizeTcxRunId: value => String(value).replace(/[^0-9_-]/g, ''),
    sanitizeCorosLabelId: value => /^\d+$/.test(String(value)) ? String(value) : '',
    isTemporaryRunMessage: () => false,
    repo: { applyRunComment }
  });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  return { handler, applyRunComment, res };
}

test.each([
  ['tcx', '2026-11-22_090000'],
  ['coros_fit', '481915529901146116']
])('%s APPLY persists the selected run id and new message', async (source, runId) => {
  const { handler, applyRunComment, res } = routeSetup();
  await handler({ body: {
    date: '2026-11-22', runId, source, message: 'new Run Comment'
  } }, res);
  expect(res.status).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ success: true, date: '2026-11-22', runId });
  expect(applyRunComment).toHaveBeenCalledWith({
    date: '2026-11-22', run_id: runId, message: 'new Run Comment'
  });
});

test('APPLY rejects a RUN id not belonging to the given date', async () => {
  const { handler, applyRunComment, res } = routeSetup();
  await handler({ body: { date: '2026-11-22', runId: '2026-11-21_090000', source: 'tcx', message: 'wrong run' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(applyRunComment).not.toHaveBeenCalled();
});

test('APPLY fails without reporting success if persistence throws', async () => {
  const { handler, applyRunComment, res } = routeSetup();
  applyRunComment.mockRejectedValueOnce(new Error('DB write failed'));
  await handler({ body: { date: '2026-11-22', runId: '123', source: 'coros_fit', message: 'new message' } }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ error: 'DB write failed' });
});

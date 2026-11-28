const fs = require('fs');
const vm = require('vm');

function api(generate = jest.fn(async () => 'new comment')) {
  const code = fs.readFileSync('index.js', 'utf8');
  const date = '2026-11-22', runId = '481584951647567878';
  const repo = { getRunMessage: jest.fn(async () => ({ message: 'saved comment' })),
    saveRunMessage: jest.fn(), saveDailySummary: jest.fn() };
  let handler;
  vm.runInNewContext(code.slice(code.indexOf("app.post('/api/advice/gemini',"),
    code.indexOf("app.post('/api/advice/gemini/chart',")), {
    app: { post: (_, fn) => { handler = fn; } }, repo,
    isTemporaryRunMessage: text => text === 'temporary',
    generateTcxRunMessage: generate,
    getCorosFitIntradayPath: () => 'fixture',
    fs: { readFile: async () => JSON.stringify({ source: 'coros_fit', labelId: runId, chartData: [{ speed: 8 }] }) },
    respondGeminiSafetyBlock(res, error) {
      if (error.code !== 'GEMINI_SAFETY_BLOCK') return false;
      res.status(422).json({ code: error.code }); return true;
    }, console: { error() {} }
  });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  return { repo, generate, res, request: body => handler({ body: { date, runId, source: 'coros_fit', ...body } }, res), date, runId };
}

test('explicit regeneration returns a candidate without changing confirmed messages', async () => {
  const t = api();
  await t.request({ regenerate: true });
  expect(t.generate).toHaveBeenCalledWith(t.date, t.runId, [{ speed: 8 }], 'gemini', { source: 'coros_fit' });
  expect(t.repo.saveRunMessage).not.toHaveBeenCalled();
  expect(t.repo.saveDailySummary).not.toHaveBeenCalled();
  expect(t.res.json).toHaveBeenCalledWith({ advice: 'new comment', provider: 'gemini-live' });
});

test.each([undefined, false])('normal viewing still reuses stored comment (%s)', async regenerate => {
  const t = api(); await t.request({ regenerate });
  expect(t.generate).not.toHaveBeenCalled();
  expect(t.repo.saveDailySummary).not.toHaveBeenCalled();
  expect(t.res.json).toHaveBeenCalledWith({ advice: 'saved comment' });
});

test('ordinary initial generation still saves both messages', async () => {
  const t = api();
  t.repo.getRunMessage.mockResolvedValue(null);
  await t.request({ regenerate: false });
  expect(t.repo.saveRunMessage).toHaveBeenCalledWith({ date: t.date, run_id: t.runId, message: 'new comment' });
  expect(t.repo.saveDailySummary).toHaveBeenCalledWith({ date: t.date, message: 'new comment' });
});

test.each([{ regenerate: 'true' }, { regenerate: true, runId: '' }, { regenerate: true, source: 'health_connect' }])('invalid regeneration request is rejected: %j', async body => {
  const t = api(); await t.request(body);
  expect(t.res.status).toHaveBeenCalledWith(400);
  expect(t.generate).not.toHaveBeenCalled();
  expect(t.repo.saveRunMessage).not.toHaveBeenCalled();
});

test.each(['error', 'safety', 'empty', 'temporary'])('generation failure preserves saved messages (%s)', async failure => {
  const generate = jest.fn(async () => {
    if (failure === 'error' || failure === 'safety') throw Object.assign(new Error('failed'),
      failure === 'safety' ? { code: 'GEMINI_SAFETY_BLOCK' } : {});
    return failure === 'empty' ? '' : 'temporary';
  });
  const t = api(generate); await t.request({ regenerate: true });
  expect(t.res.status).toHaveBeenCalledWith(failure === 'safety' ? 422 : 500);
  expect(t.repo.saveRunMessage).not.toHaveBeenCalled();
  expect(t.repo.saveDailySummary).not.toHaveBeenCalled();
});

function ui() {
  const code = fs.readFileSync('public/script.js', 'utf8');
  const elements = {
    regenerateRunCommentBtn: { disabled: false }, regenerateRunCommentStatus: {},
    runCommentPrefixInput: { value: 'saved prefix', dataset: { savedText: 'saved prefix' }, disabled: false },
    saveRunCommentPrefixBtn: { disabled: false }, dateInput: { value: '2026-11-22' },
    analyzeBtn: { disabled: false }, 'daily-message-text': { textContent: 'old comment' },
    'daily-message-container': { style: {} }
  };
  const context = {
    document: { getElementById: id => elements[id] }, normalizeRunDate: value => value,
    currentAdviceRunDate: '2026-11-22', currentRunChartSource: 'coros_fit',
    runCommentViewRevision: 0, runCommentCandidate: null,
    selectedId: '481584951647567878', getSelectedAdviceRunId: () => context.selectedId,
    showGeminiSafetyBlock: jest.fn(),
    fetch: jest.fn(async () => ({ ok: true, json: async () => ({ advice: 'new comment' }) }))
  };
  vm.runInNewContext(code.slice(code.indexOf('async function regenerateSelectedRunComment()'),
    code.indexOf('async function applySelectedRunAdviceFromCurrentView()')), context);
  return { context, elements, run: () => context.regenerateSelectedRunComment() };
}

test('button sends exact run ID with explicit regeneration and displays new comment', async () => {
  const t = ui(); await t.run();
  expect(JSON.parse(t.context.fetch.mock.calls[0][1].body)).toEqual({ date: '2026-11-22',
    runId: '481584951647567878', source: 'coros_fit', regenerate: true });
  expect(t.elements['daily-message-text'].textContent).toBe('new comment');
  expect(t.elements.regenerateRunCommentBtn.disabled).toBe(false);
});

test.each(['dirty', 'loading', 'date', 'source'])('unready selection/settings never send a request (%s)', async kind => {
  const t = ui();
  if (kind === 'dirty') t.elements.runCommentPrefixInput.value = 'not saved';
  if (kind === 'loading') t.elements.runCommentPrefixInput.disabled = true;
  if (kind === 'date') t.elements.dateInput.value = '2026-11-21';
  if (kind === 'source') t.context.currentRunChartSource = 'health_connect';
  await t.run(); expect(t.context.fetch).not.toHaveBeenCalled();
});

test('selection changes and repeated clicks while pending cannot replace another run comment', async () => {
  const t = ui(); let finish;
  t.context.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const first = t.run(); await t.run();
  t.context.selectedId = 'other-run';
  finish({ ok: true, json: async () => ({ advice: 'new comment' }) }); await first;
  expect(t.context.fetch).toHaveBeenCalledTimes(1);
  expect(t.elements['daily-message-text'].textContent).toBe('old comment');
});

test('UI failure retains displayed comment and input and releases busy state', async () => {
  const t = ui(); t.context.fetch.mockRejectedValue(new Error('network'));
  await t.run();
  expect(t.elements['daily-message-text'].textContent).toBe('old comment');
  expect(t.elements.runCommentPrefixInput.value).toBe('saved prefix');
  expect(t.elements.runCommentPrefixInput.disabled).toBe(false);
  expect(t.elements.regenerateRunCommentStatus.textContent).toContain('network');
});

test('leaving and returning to the same run discards a late candidate', async () => {
  const t = ui(); let finish;
  t.context.fetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = t.run();
  t.context.runCommentViewRevision += 2;
  finish({ ok: true, json: async () => ({ advice: 'late candidate' }) });
  await pending;
  expect(t.elements['daily-message-text'].textContent).toBe('old comment');
  expect(t.context.runCommentCandidate).toBeNull();
});

test('regenerated candidate is explicitly bound to selected date, run and source', async () => {
  const t = ui(); await t.run();
  expect(t.context.runCommentCandidate).toEqual({ date: '2026-11-22',
    runId: '481584951647567878', source: 'coros_fit', message: 'new comment' });
  expect(t.elements.regenerateRunCommentStatus.textContent).toContain('Apply（確定）');
});

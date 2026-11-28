const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('public/script.js', 'utf8');

function setup() {
  const date = '2026-11-23';
  const input = { value: date };
  const ctx = {
    document: { hidden: false, getElementById: id => id === 'dateInput' ? input : { disabled: false } },
    currentTcxRunPageDate: date, currentCorosFitRunPageDate: date,
    currentTcxRunPages: [], currentTcxRunPageIndex: 0,
    currentCorosFitRuns: [{ labelId: 'first' }], currentCorosFitRunPageIndex: 0,
    getSelectedTcxRun: () => ctx.currentTcxRunPages[ctx.currentTcxRunPageIndex],
    getSelectedCorosFitRun: () => ctx.currentCorosFitRuns[ctx.currentCorosFitRunPageIndex],
    fetchTcxRuns: jest.fn(async () => []),
    fetchCorosFitRuns: jest.fn(async () => [{ labelId: 'earlier' }, { labelId: 'first' }, { labelId: 'second' }]),
    updateActiveRunPager: jest.fn(), updateRunSourceControls: jest.fn()
  };
  vm.runInNewContext(code.slice(code.indexOf('let runListRefreshPending'), code.indexOf('function changeTcxRunPage')), ctx);
  return { ctx, input };
}

test('second imported run becomes available without moving selected run or replacing its comment', async () => {
  const { ctx } = setup();
  await ctx.refreshAvailableRunLists();
  expect(ctx.currentCorosFitRuns.map(r => r.labelId)).toEqual(['earlier', 'first', 'second']);
  expect(ctx.currentCorosFitRunPageIndex).toBe(1);
  expect(ctx.updateActiveRunPager).toHaveBeenCalledTimes(1);
});

test('failed list reads retain the previous list', async () => {
  const { ctx } = setup();
  ctx.fetchCorosFitRuns.mockRejectedValue(new Error('offline'));
  await ctx.refreshAvailableRunLists();
  expect(ctx.currentCorosFitRuns).toEqual([{ labelId: 'first' }]);
});

test('late response cannot replace a different date and overlapping refreshes are suppressed', async () => {
  const { ctx, input } = setup();
  let finish;
  ctx.fetchCorosFitRuns.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const pending = ctx.refreshAvailableRunLists();
  await ctx.refreshAvailableRunLists();
  input.value = '2026-11-24';
  finish([{ labelId: 'second' }]);
  await pending;
  expect(ctx.fetchCorosFitRuns).toHaveBeenCalledTimes(1);
  expect(ctx.currentCorosFitRuns).toEqual([{ labelId: 'first' }]);
});

test.each(['http', 'network'])('Google Fit failure does not erase successfully loaded local RUNs: %s', async failure => {
  const start = code.indexOf('async function loadData(options = {})');
  const end = code.indexOf('        const selectedTcxRun =', start);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '2026-11-23', style: {} });
    return elements.get(id);
  };
  const ctx = {
    runCommentViewRevision: 0, runCommentCandidate: null,
    document: { getElementById: element, querySelector: element },
    setLapExportState() {}, setTcxExportState() {}, URLSearchParams,
    fetch: async () => {
      if (failure === 'network') throw new Error('offline');
      return { ok: false, text: async () => 'invalid_grant' };
    },
    fetchDetailedFitSpeedSeries: async () => [], fetchDetailedFitHeartRateSeries: async () => [],
    fetchDetailedFitPitchSeries: async () => [], fetchDetailedFitStrideSeries: async () => [],
    fetchTcxRuns: async () => [], fetchCorosFitRuns: async () => [{ labelId: 'first' }, { labelId: 'second' }],
    fetchDailySummary: async () => ({}), fetchDailySessions: async () => [],
    currentTcxRunPageDate: '', currentCorosFitRunPageDate: '', currentHealthConnectRunPageDate: '',
    currentTcxRunPageIndex: 0, currentCorosFitRunPageIndex: 0, currentHealthConnectRunPageIndex: 0
  };
  vm.runInNewContext(code.slice(start, end) + '\n } finally {}\n}', ctx);
  await ctx.loadData();
  expect(ctx.currentCorosFitRuns.map(r => r.labelId)).toEqual(['first', 'second']);
  expect(element('runDataStatus').textContent).toContain('Google Fit');
});

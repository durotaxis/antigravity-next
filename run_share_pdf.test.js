const fs = require('fs');
const vm = require('vm');

function setup() {
    const pages = [[]];
    let current = 0;
    const context = {
        document: { createElement: () => ({ width: 1000, height: 250,
            toDataURL: () => 'data:image/png;base64,test',
            getContext: () => ({ fillRect() {}, drawImage() {}, fillText() {}, measureText: text => ({ width: text.length * 13 }) })
        }) },
        jspdf: { jsPDF: class {
            constructor() { this.internal = { pageSize: { getWidth: () => 842, getHeight: () => 595 } }; }
            setFontSize() {} setTextColor() {} setProperties() {}
            text(text, x, y) { pages[current].push({ text, x, y }); }
            addImage(data, format, x, y, width, height) { pages[current].push({ x, y, width, height }); }
            addPage() { pages.push([]); current++; }
            getNumberOfPages() { return pages.length; }
            setPage(page) { current = page - 1; }
        } }
    };
    vm.runInNewContext(fs.readFileSync('public/run-share-pdf.js', 'utf8'), context);
    const snapshot = { date: '2026-10-30', runId: '123', source: 'coros_fit', tableSource: 'Google Fit (day)',
        charts: Array.from({ length: 3 }, (_, index) => ({ title: `Chart ${index}`, canvas: { width: 1000, height: 250 } })),
        headers: ['Lap', 'Distance', 'Speed', 'Pitch', 'HR', 'Stride'],
        rows: Array.from({ length: 80 }, (_, index) => [String(index + 1), '1 km', '8.0', '160', '140', '85.0']) };
    return { exporter: context.RunSharePdf, snapshot, pages };
}

test('long split tables paginate with repeated identity and no images outside page margins', () => {
    const { exporter, snapshot, pages } = setup();
    exporter.create(snapshot);
    expect(pages.length).toBeGreaterThan(3);
    for (const page of pages) {
        expect(page.some(item => item.text?.includes('Run ID: 123'))).toBe(true);
        for (const image of page.filter(item => item.width)) {
            expect(image.x + image.width).toBeLessThanOrEqual(810.01);
            expect(image.y + image.height).toBeLessThan(565);
        }
    }
    expect(pages.filter(page => page.some(item => item.text?.startsWith('1km Splits'))).length).toBeGreaterThan(1);
});

test.each(['charts', 'rows'])('missing %s produces an error instead of a partial PDF', field => {
    const { exporter, snapshot } = setup();
    snapshot[field] = [];
    expect(() => exporter.create(snapshot)).toThrow();
});

test('loading or missing-data placeholder rows cannot masquerade as a split table', () => {
    const { exporter, snapshot } = setup();
    snapshot.rows = [['Loading splits...']];
    expect(() => exporter.create(snapshot)).toThrow();
});

test('changing the selected date without reloading refuses to export stale charts', async () => {
    const script = fs.readFileSync('public/script.js', 'utf8');
    const body = script.slice(script.indexOf('async function exportSelectedRunPdf()'), script.indexOf('\nasync function loadData(', script.indexOf('async function exportSelectedRunPdf()')));
    const save = jest.fn();
    const context = { currentTcxMinuteExport: { date: '2026-10-30' },
        normalizeRunDate: value => value,
        document: { getElementById: id => id === 'dateInput' ? { value: '2026-10-29' } : { disabled: false } },
        window: { RunSharePdf: { save } } };
    vm.runInNewContext(body, context);
    await expect(context.exportSelectedRunPdf()).rejects.toThrow('RUN ANALYZER');
    expect(save).not.toHaveBeenCalled();
});


test('long Japanese comment paginates without changing the chart and split pages', () => {
    const original = setup();
    original.exporter.create(original.snapshot);
    const { exporter, snapshot, pages } = setup();
    snapshot.message = '新画面のランコメントです。'.repeat(700) + '\n最後の段落';
    exporter.create(snapshot);
    const commentPages = pages.filter(page => page.some(item => item.text?.startsWith('RUN COMMENT')));
    expect(commentPages.length).toBeGreaterThan(1);
    expect(pages.length - commentPages.length).toBe(original.pages.length);
    for (const page of commentPages) {
        for (const image of page.filter(item => item.width)) {
            expect(image.y + image.height).toBeLessThan(565);
        }
    }
});

test('blank DB comment adds no comment page', () => {
    const { exporter, snapshot, pages } = setup();
    snapshot.message = '  ';
    exporter.create(snapshot);
    expect(pages.some(page => page.some(item => item.text?.startsWith('RUN COMMENT')))).toBe(false);
});

// Exercise the actual selection/HTTP/snapshot flow, not only the PDF renderer.
function exportSetup(source = 'coros_fit') {
    const date = '2026-11-07';
    const runIds = ['481584951647567878', '481585163711578613'];
    const messages = new Map(runIds.map((id, i) => [id, `検証用コメント${i + 1}: RUN ${id}`]));
    const save = jest.fn();
    const canvas = { width: 1936, height: 421 };
    const cells = values => values.map(textContent => ({ textContent }));
    const elements = {
        dateInput: { value: date }, analyzeBtn: { disabled: false },
        tcxStrideChartWrapper: { querySelector: () => canvas },
        lapTable: { querySelectorAll: selector => selector === 'thead th' ? cells(['Lap', 'Speed'])
            : [{ querySelectorAll: () => cells(['1', '7.8']) }] }
    };
    elements.tcxLapTable = elements.lapTable;
    const context = {
        currentTcxMinuteExport: { date }, currentRunChartSource: source,
        currentHealthConnectRuns: runIds.map(runId => ({ runId })), currentHealthConnectRunPageIndex: 0,
        selectedId: runIds[0], normalizeRunDate: value => value,
        getSelectedActiveRun: () => ({ runId: context.selectedId }),
        isElementVisibleForExport: wrapper => !!wrapper,
        document: { getElementById: id => elements[id] },
        window: { RunSharePdf: { save } },
        fetch: jest.fn(async url => {
            const runId = url.split('/run-message/')[1];
            return { ok: true, json: async () => ({ date, run_id: runId,
                message: runId ? messages.get(runId) : '日次コメント（後半RUN）' }) };
        })
    };
    const script = fs.readFileSync('public/script.js', 'utf8');
    const start = script.indexOf('async function exportSelectedRunPdf()');
    vm.runInNewContext(script.slice(start, script.indexOf('\nasync function loadData(', start)), context);
    return { context, save, runIds, messages, elements, date };
}

test.each(['coros_fit', 'tcx'])('%s exports each selected RUN comment, including switching back', async source => {
    const { context, save, runIds, messages, date } = exportSetup(source);
    for (const runId of [...runIds, runIds[0]]) {
        context.selectedId = runId;
        await context.exportSelectedRunPdf();
        expect(context.fetch).toHaveBeenLastCalledWith(`/api/daily/${date}/run-message/${runId}`, { cache: 'no-store' });
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ runId, message: messages.get(runId), selectedRunComment: true }));
    }
});

test('Health Connect retains its existing daily comment', async () => {
    const { context, save, date } = exportSetup('health_connect');
    await context.exportSelectedRunPdf();
    expect(context.fetch).toHaveBeenCalledWith(`/api/daily/${date}`, { cache: 'no-store' });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ message: '日次コメント（後半RUN）', selectedRunComment: false }));
});

test.each(['date', 'run_id'])('rejects a mismatched comment %s', async field => {
    const { context, save, date, runIds } = exportSetup();
    context.fetch.mockResolvedValue({ ok: true, json: async () => ({ date, run_id: runIds[0], message: 'wrong', [field]: 'wrong' }) });
    await expect(context.exportSelectedRunPdf()).rejects.toThrow('一致しません');
    expect(save).not.toHaveBeenCalled();
});

test.each(['run', 'source', 'date'])('selection change during comment read rejects export: %s', async field => {
    const { context, save, date, runIds, elements } = exportSetup();
    context.fetch.mockImplementation(async () => {
        if (field === 'run') context.selectedId = runIds[1];
        if (field === 'source') context.currentRunChartSource = 'tcx';
        if (field === 'date') elements.dateInput.value = '2026-11-06';
        return { ok: true, json: async () => ({ date, run_id: runIds[0], message: 'old selection' }) };
    });
    await expect(context.exportSelectedRunPdf()).rejects.toThrow('選択が変わりました');
    expect(save).not.toHaveBeenCalled();
});

test.each([404, 500, 'network'])('failed per-run read never falls back to the daily message: %s', async status => {
    const { context, save } = exportSetup();
    if (status === 'network') context.fetch.mockRejectedValue(new Error('offline'));
    else context.fetch.mockResolvedValue({ ok: false, status });
    await expect(context.exportSelectedRunPdf()).rejects.toThrow();
    expect(context.fetch).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
});

test('empty per-run comment stays empty instead of substituting daily text', async () => {
    const { context, save, messages, runIds } = exportSetup();
    messages.set(runIds[0], '');
    await context.exportSelectedRunPdf();
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ message: '' }));
});

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

test('changing the selected date without reloading refuses to export stale charts', () => {
    const script = fs.readFileSync('public/script.js', 'utf8');
    const body = script.slice(script.indexOf('function exportSelectedRunPdf()'), script.indexOf('\nasync function loadData(', script.indexOf('function exportSelectedRunPdf()')));
    const save = jest.fn();
    const context = { currentTcxMinuteExport: { date: '2026-10-30' },
        normalizeRunDate: value => value,
        document: { getElementById: id => id === 'dateInput' ? { value: '2026-10-29' } : { disabled: false } },
        window: { RunSharePdf: { save } } };
    vm.runInNewContext(body, context);
    expect(() => context.exportSelectedRunPdf()).toThrow('RUN ANALYZER');
    expect(save).not.toHaveBeenCalled();
});

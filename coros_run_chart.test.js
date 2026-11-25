const zlib = require('zlib');
const { renderCorosRunChartPng } = require('./coros_run_chart');

function pngPixels(png) {
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8); // bit depth
  expect(png[25]).toBe(6); // RGBA
  const payloads = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') payloads.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
    if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(payloads));
  expect(raw.length).toBe((width * 4 + 1) * height);
  expect(raw[0]).toBe(0);
  return { width, height, raw };
}

test('COROS FIT minute rows produce a valid two-panel PNG with four colored series', () => {
  const start = Date.parse('2026-11-22T10:00:00+09:00');
  const rows = Array.from({ length: 10 }, (_, i) => ({
    bucketStartMs: start + i * 60000,
    coverageSeconds: 60,
    stride: 70 + i * 2,
    heartRate: 110 + i * 4,
    speed: 6 + i * 0.5,
    pitch: 155 + i * 3,
    altitude: 4 + Math.sin(i) * 3
  }));
  const png = renderCorosRunChartPng(rows);
  const { width, height, raw } = pngPixels(png);
  expect(width).toBe(1120);
  expect(height).toBe(760);
  // Search plot pixels only, excluding colored legends and axis labels.
  const colors = ['0,242,255', '255,0,85', '122,240,184', '255,209,102'];
  const found = new Set();
  const stride = width * 4 + 1;
  for (const [top, bottom] of [[101, 306], [450, 655]]) {
    for (let y = top; y <= bottom; y++) {
      for (let x = 94; x < width - 100; x++) {
        const at = y * stride + 1 + x * 4;
        const rgb = raw.subarray(at, at + 3).join(',');
        if (colors.includes(rgb)) found.add(rgb);
      }
    }
  }
  expect([...found].sort()).toEqual(colors.sort());
});

test('missing samples remain gaps and valid FIT timestamps are required', () => {
  const start = Date.parse('2026-11-22T10:00:00+09:00');
  expect(() => renderCorosRunChartPng([])).toThrow(/timestamps/);
  const png = renderCorosRunChartPng([
    { bucketStartMs: start, stride: 60, heartRate: null, speed: 7, pitch: 170 },
    { bucketStartMs: start + 4 * 60000, stride: null, heartRate: 120, speed: null, pitch: 180 }
  ]);
  expect(pngPixels(png).width).toBe(1120);
  expect(renderCorosRunChartPng([{ bucketStartMs: start, speed: 7 }])).toEqual(
    renderCorosRunChartPng([{ bucketStartMs: start, speed: 7 }])
  );
});

test('COROS FIT comment wiring supplies generated chart to Gemini', () => {
  const source = require('fs').readFileSync(require.resolve('./index.js'), 'utf8');
  const routine = source.slice(source.indexOf('async function generateTcxRunMessage('),
    source.indexOf('async function generateAndPersistCorosFitRunMessage('));
  expect(routine).toContain("source === 'coros_fit' && adviceProvider === 'gemini'");
  expect(routine).toContain('renderCorosRunChartPng(minuteRows)');
  expect(routine).toContain('chartImageDataUrl');
  expect(routine).toContain('minuteTableMarkdown');
});
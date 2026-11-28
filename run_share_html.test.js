const fs = require('fs');
const vm = require('vm');
const ctx = {};
vm.runInNewContext(fs.readFileSync('public/run-share-html.js', 'utf8'), ctx);

function chart(indices, dimensions = { left: 0, width: 100, height: 100 }) {
  const svg = {
    getBoundingClientRect: () => dimensions,
    querySelectorAll: selector => selector === '[data-export-point-index]' ? indices.map(index => ({
      getAttribute: () => String(index),
      getBoundingClientRect: () => ({ left: index * 40, width: 4 })
    })) : []
  };
  return { getAttribute: () => JSON.stringify(['first date', 'second date']),
    querySelector: selector => selector === '.recharts-wrapper > svg.recharts-surface' ? svg : null };
}

test('export uses explicit indices despite duplicate/reordered layers or missing internal dot classes', () => {
  const result = ctx.RunShareHtml.chartPoints(chart([1, 0, 1]));
  expect(result.map(p => p.text)).toEqual(['first date', 'second date']);
  expect(result.map(p => p.x)).toEqual([0.02, 0.42]);
});

test('unfinished charts cannot be exported', () => {
  expect(() => ctx.RunShareHtml.chartPoints(chart([0]))).toThrow('描画完了');
  expect(() => ctx.RunShareHtml.chartPoints(chart([0, 1], { width: 0, height: 100 }))).toThrow('描画完了');
});

test('empty filtered chart reports missing data', () => {
  const holder = chart([]);
  holder.getAttribute = () => '[]';
  expect(() => ctx.RunShareHtml.chartPoints(holder)).toThrow('データがありません');
});

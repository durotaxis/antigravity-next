const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('push wakes the worker and displays a notification without a window client', async () => {
  const handlers = {};
  const shown = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/coros-import-notifications-sw.js'), 'utf8'), {
    self: { addEventListener: (name, fn) => { handlers[name] = fn; },
      registration: { showNotification: async (title, options) => shown.push({ title, options }) } }, URL,
  });
  let pending;
  handlers.push({ data: { json: () => ({ title: '受信完了', body: '反映 1件', tag: 'request-1', url: '/?date=2026-10-31' }) },
    waitUntil: task => { pending = task; } });
  await pending;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, '受信完了');
  assert.equal(shown[0].options.data.url, '/?date=2026-10-31');
});

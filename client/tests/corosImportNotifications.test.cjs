const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Use the client's existing compiler; no extra test framework or dependency.
const source = fs.readFileSync(path.join(__dirname, '../lib/corosImportNotifications.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
const exportsObject = {};
vm.runInNewContext(compiled.outputText, { exports: exportsObject });
const { deliverImportNotifications, readNotificationPreferences, setImportNotifications } = exportsObject;
const event = sequence => ({ sequence, date: '2026-09-21', runId: String(sequence), completedAt: '2026-09-21T10:00:00Z' });
function setup() {
  const data = new Map();
  const shown = [];
  const storage = { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
  return { key: 'notifications:test', storage, shown, show: async (title, options) => { shown.push({ title, options }); }, url: 'https://app.example/' };
}

test('opt-in starts at the current event; repeated polls and reopened pages stay silent', async () => {
  const options = setup();
  const snapshot = { completionSequence: 2, completions: [event(1), event(2)] };
  assert.equal(await deliverImportNotifications({ ...options, snapshot }), 0);
  setImportNotifications(options.storage, options.key, true, 2);
  assert.equal(await deliverImportNotifications({ ...options, snapshot }), 0);
  const updated = { completionSequence: 3, completions: [...snapshot.completions, event(3)] };
  assert.equal(await deliverImportNotifications({ ...options, snapshot: updated }), 1);
  assert.equal(await deliverImportNotifications({ ...options, snapshot: updated }), 0);
  assert.equal(options.shown.length, 1);
  assert.equal(readNotificationPreferences(options.storage, options.key).cursor, 3);
});

test('notification failure retries the failed event without repeating earlier successes', async () => {
  const options = setup();
  setImportNotifications(options.storage, options.key, true, 0);
  const snapshot = { completionSequence: 2, completions: [event(1), event(2)] };
  let calls = 0;
  await assert.rejects(deliverImportNotifications({ ...options, snapshot, show: async () => { if (++calls === 2) throw new Error('display failed'); } }));
  assert.equal(readNotificationPreferences(options.storage, options.key).cursor, 1);
  assert.equal(await deliverImportNotifications({ ...options, snapshot }), 1);
  assert.equal(options.shown[0].options.tag, 'coros-import-2026-09-21-2');
});

test('turning notifications off suppresses imports', async () => {
  const options = setup();
  setImportNotifications(options.storage, options.key, false, 0);
  assert.equal(await deliverImportNotifications({ ...options, snapshot: { completionSequence: 1, completions: [event(1)] } }), 0);
});

test('server journal reset establishes a fresh baseline', async () => {
  const options = setup();
  setImportNotifications(options.storage, options.key, true, 50);
  assert.equal(await deliverImportNotifications({ ...options, snapshot: { completionSequence: 1, completions: [event(1)] } }), 0);
  assert.equal(readNotificationPreferences(options.storage, options.key).cursor, 1);
});

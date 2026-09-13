const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const exec = promisify(execFile);
const { SyncRun, activity, jst, atomicWrite, request } = require('./coros_sync_runner');
const { decodeFitRecords } = require('../coros_fit_importer');
const base = { labelId: '480194369278738634', sportType: 100, startTimestamp: 1788862179, endTimestamp: 1788863404 };
const a = activity(base);
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coros-runner-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = new SyncRun(root, path.join(root, 'memory.md'));
  await atomicWrite(run.statePath, { version: 2, lastImportedActivity: { ...a, startTimestamp: a.startTimestamp - 60 }, lastSuccessfulListCheckAt: jst(), updatedAt: jst() });
  return { root, run };
}
async function fitBytes() {
  const { Encoder } = await import('@garmin/fitsdk');
  const encoder = new Encoder();
  encoder.onMesg(20, { timestamp: new Date(base.startTimestamp * 1000), distance: 1, heartRate: 130 });
  encoder.onMesg(20, { timestamp: new Date((base.startTimestamp + 1) * 1000), distance: 2, heartRate: 131 });
  return Buffer.from(encoder.close());
}
async function savePair(run, target = a, bytes) {
  const p = run.paths(target);
  bytes ||= await fitBytes();
  await fs.mkdir(path.dirname(p.fit), { recursive: true });
  await fs.writeFile(p.fit, bytes);
  await atomicWrite(p.meta, { source: 'coros_fit', ...target, startTime: jst(target.startTimestamp * 1000), endTime: jst(target.endTimestamp * 1000),
    originalFitPath: p.fit, fitSizeBytes: bytes.length, fitSha256: crypto.createHash('sha256').update(bytes).digest('hex'), activityDetails: { raw: 'actual response' } });
}
test('Unix seconds and exact large IDs; no lookback boundary', async t => {
  const { run } = await fixture(t);
  const initial = await run.start();
  assert.equal(initial.query.startDate, '20260908');
  assert.equal(initial.boundary.startTimestamp, a.startTimestamp - 60);
  assert.throws(() => activity({ ...base, labelId: Number(base.labelId) }));
  assert.throws(() => activity({ ...base, startTimestamp: base.startTimestamp * 1000 }));
});
test('corrupt state is preserved, not silently reset', async t => {
  const { run } = await fixture(t);
  await fs.writeFile(run.statePath, '{broken');
  await assert.rejects(run.start());
  await run.finish(new Error('invalid state'));
  assert.equal(await fs.readFile(run.statePath, 'utf8'), '{broken');
});
test('validated saved activity recovers cursor after interrupted state commit', async t => {
  const { run } = await fixture(t);
  await savePair(run);
  await run.start();
  const next = await run.plan([a], true);
  assert.equal(next.action, 'finish');
  assert.equal(run.state.lastImportedActivity.startTimestamp, a.startTimestamp);
  assert.equal(run.counts.imported, 0);
  assert.equal(run.counts.skipped, 1);
  assert.equal((await run.finish()).ok, true);
});
test('zero result preserves cursor and records a successful no-op', async t => {
  const { run } = await fixture(t);
  await run.start();
  const before = structuredClone(run.state.lastImportedActivity);
  await run.plan([], true);
  await run.finish();
  assert.deepEqual(run.state.lastImportedActivity, before);
  assert.equal(run.state.consecutiveFailures, 0);
  assert.ok(run.state.lastSuccessfulSyncAt);
});
test('truncated FIT with matching SHA and signature still requires download', async t => {
  const { run } = await fixture(t);
  const bytes = (await fitBytes()).subarray(0, 25);
  await savePair(run, a, bytes);
  await assert.rejects(decodeFitRecords(run.paths(a).fit));
  assert.equal((await run.inspect(a)).action, 'download');
});
test('new FIT commit validates full file and persists before cursor', async t => {
  const { run } = await fixture(t);
  await run.start();
  await run.plan([a], true);
  run.download = fitBytes;
  const next = await run.commit({ labelId: a.labelId, downloadUrl: 'unused', activityDetails: { raw: 'detail response' } });
  assert.equal(next.action, 'finish');
  assert.equal(run.counts.imported, 1);
  assert.equal((await run.inspect(a)).action, 'skip');
  assert.equal((await run.finish()).ok, true);
});
test('metadata-only repair avoids download and preserves downloadedAt', async t => {
  const { run } = await fixture(t);
  await savePair(run);
  const meta = JSON.parse(await fs.readFile(run.paths(a).meta));
  meta.fitSha256 = 'wrong';
  meta.downloadedAt = '2026-09-08T10:00:00Z';
  await atomicWrite(run.paths(a).meta, meta);
  await run.start();
  assert.equal((await run.plan([a], true)).action, 'metadata');
  run.download = () => { throw new Error('unexpected download'); };
  await run.commit({ labelId: a.labelId, activityDetails: { raw: 'detail' } });
  assert.equal(run.counts.repaired, 1);
  assert.equal(JSON.parse(await fs.readFile(run.paths(a).meta)).downloadedAt, meta.downloadedAt);
});
test('failure cannot skip ahead to a later saved run; success timestamp preserved', async t => {
  const { run } = await fixture(t);
  const later = activity({ ...base, labelId: '480194369278738635', startTimestamp: base.startTimestamp + 1 });
  await savePair(run, later);
  await run.start();
  run.state.lastSuccessfulSyncAt = '2026-09-08T19:00:00+09:00';
  const before = structuredClone(run.state.lastImportedActivity);
  await run.plan([later, a], true);
  run.download = async () => { throw new Error('HTTP 401'); };
  await assert.rejects(run.commit({ labelId: a.labelId, activityDetails: {} }));
  await run.finish(new Error('HTTP 401'));
  assert.deepEqual(run.state.lastImportedActivity, before);
  assert.equal(run.state.lastSuccessfulSyncAt, '2026-09-08T19:00:00+09:00');
  assert.equal(run.state.consecutiveFailures, 1);
});
test('incomplete list cannot update cursor or successful list check', async t => {
  const { run } = await fixture(t);
  await run.start();
  const before = run.state.lastSuccessfulListCheckAt;
  await assert.rejects(run.plan([a], false));
  assert.equal(run.state.lastSuccessfulListCheckAt, before);
});
test('history bounded to 50 and errors redact URLs', async t => {
  const { run } = await fixture(t);
  await atomicWrite(run.historyPath, Array.from({ length: 50 }, (_, i) => ({ i })));
  await run.start();
  await run.finish(new Error('failed https://s3.coros.com/secret?token=hidden'));
  const history = JSON.parse(await fs.readFile(run.historyPath));
  assert.equal(history.length, 50);
  assert.ok(!JSON.stringify(history).includes('hidden'));
});
test('named pipe holds across requests, excludes another owner and releases on finish', async t => {
  const { root } = await fixture(t);
  const modulePath = require.resolve('./coros_sync_runner');
  const args = ['-e', `require(${JSON.stringify(modulePath)}).serve(process.argv[1], process.argv[2])`, root, path.join(root, 'memory.md')];
  const child = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const ready = await new Promise((resolve, reject) => {
    let text = '';
    child.stdout.on('data', b => { text += b; if (text.includes('\n')) resolve(JSON.parse(text.split('\n')[0])); });
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`worker exited before ready: ${code}`)));
  });
  assert.equal(ready.status, 'ready');
  const duplicate = await exec(process.execPath, args, { windowsHide: true });
  assert.equal(JSON.parse(duplicate.stdout).status, 'busy');
  assert.equal((await request(root, { token: 'wrong', command: 'finish' })).ok, false);
  assert.equal((await request(root, { token: ready.token, command: 'plan', activities: [], complete: true })).ok, true);
  assert.equal((await request(root, { token: ready.token, command: 'finish' })).result.ok, true);
  await new Promise(resolve => child.once('exit', resolve));
  const next = spawn(process.execPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => next.kill());
  const nextReady = await new Promise(resolve => next.stdout.once('data', b => resolve(JSON.parse(String(b)))));
  assert.equal(nextReady.status, 'ready');
  await request(root, { token: nextReady.token, command: 'fail', error: 'test termination' });
  await new Promise(resolve => next.once('exit', resolve));
});
test('watchdog sees stale success despite fresh execution and repeated failures', async t => {
  const { root, run } = await fixture(t);
  const out = path.join(root, 'watchdog.json');
  const watchdog = path.resolve(__dirname, 'coros_sync_watchdog.ps1');
  for (const [failures, minutesAgo, expected] of [[0, 1, false], [1, 30, true], [3, 1, true]]) {
    await atomicWrite(run.statePath, { updatedAt: jst(), lastAttemptAt: jst(), lastRunStatus: failures ? 'failed' : 'success',
      lastSuccessfulSyncAt: jst(Date.now() - minutesAgo * 60000), consecutiveFailures: failures });
    await exec('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', watchdog, '-StatePath', run.statePath, '-WatchdogStatePath', out, '-NoNotify'], { windowsHide: true });
    assert.equal(JSON.parse(await fs.readFile(out)).stale, expected);
  }
});
test('download retries a transient failure but not HTTP 401', async t => {
  const { run } = await fixture(t);
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let calls = 0;
  const bytes = await fitBytes();
  global.fetch = async () => ++calls === 1 ? new Response('', { status: 503 }) : new Response(bytes);
  assert.deepEqual(await run.download('https://s3.coros.com/test.fit'), bytes);
  assert.equal(calls, 2);
  calls = 0;
  global.fetch = async () => { calls++; return new Response('', { status: 401 }); };
  await assert.rejects(run.download('https://s3.coros.com/test.fit'), /401/);
  assert.equal(calls, 1);
});
test('expired run rejects commit and retains cursor', async t => {
  const { run } = await fixture(t);
  await run.start();
  await run.plan([a], true);
  const before = structuredClone(run.state.lastImportedActivity);
  run.startedMs -= 240001;
  await assert.rejects(run.commit({ labelId: a.labelId, activityDetails: {} }), /deadline/);
  assert.deepEqual(run.state.lastImportedActivity, before);
  assert.equal((await run.finish(new Error('deadline exceeded'))).status, 'failed');
});

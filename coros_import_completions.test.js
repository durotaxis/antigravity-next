const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createCorosImportCompletions, fitRevision, completedImports } = require('./coros_import_completions');
const { createCorosAutoImport, createCorosAutoImportRouter } = require('./coros_auto_import');
const express = require('express');
const request = require('supertest');

describe('COROS completion notifications', () => {
  let root, journalPath;
  const run = (runId = '123', revision = 'fit:one') => ({ date: '2026-09-21', runId, revision });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'coros-completions-'));
    journalPath = path.join(root, 'import-completions.json');
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  test('empty scans stay silent; repeated FIT/inbox completion and restarts do not duplicate', async () => {
    let journal = createCorosImportCompletions(journalPath);
    await journal.record([]);
    expect(await journal.getSnapshot()).toEqual({ completionSequence: 0, completions: [] });
    await journal.record([run(), run()]);
    journal = createCorosImportCompletions(journalPath);
    await journal.record([run()]);
    expect((await journal.getSnapshot()).completionSequence).toBe(1);
    await journal.record([run('123', 'fit:updated'), run('456')]);
    expect((await journal.getSnapshot()).completions.map(item => item.runId)).toEqual(['123', '123', '456']);
  });

  test('bounded event history retains revision deduplication for old RUNs', async () => {
    let journal = createCorosImportCompletions(journalPath);
    await journal.record(Array.from({ length: 105 }, (_, i) => run(String(i))));
    journal = createCorosImportCompletions(journalPath);
    await journal.record([run('0')]);
    const snapshot = await journal.getSnapshot();
    expect(snapshot.completionSequence).toBe(105);
    expect(snapshot.completions).toHaveLength(100);
    expect(snapshot.completions[0].sequence).toBe(6);
  });

  test('failed journal save does not publish an uncommitted completion and can retry', async () => {
    const journal = createCorosImportCompletions(journalPath);
    await journal.record([run()]);
    await fs.unlink(journalPath);
    await fs.mkdir(journalPath);
    await expect(journal.record([run('456')])).rejects.toThrow();
    expect((await journal.getSnapshot()).completionSequence).toBe(1);
    await fs.rmdir(journalPath);
    await journal.record([run('456')]);
    expect((await journal.getSnapshot()).completionSequence).toBe(2);
  });

  test('corrupt history is reported instead of resetting its deduplication state', async () => {
    await fs.writeFile(journalPath, '{broken');
    await expect(createCorosImportCompletions(journalPath).getSnapshot()).rejects.toThrow();
  });

  test('API exposes completion only after a successful save; failed RUNs remain errors', async () => {
    let finish;
    const scan = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const controller = createCorosAutoImport({ settingsPath: path.join(root, 'settings.json'), scan, onError: jest.fn() });
    const app = express();
    app.use('/status', createCorosAutoImportRouter(controller));
    await controller.start();
    const before = await request(app).get('/status').expect(200);
    expect(before.body.completionSequence).toBe(0);
    expect(before.body.running).toBe(true);
    finish({ completed: [run()], failed: [{ file: 'other.fit', error: 'comment generation failed' }] });
    await controller.stop();
    const after = await request(app).get('/status').expect(200);
    expect(after.body.completions).toHaveLength(1);
    expect(after.body.completions[0].runId).toBe('123');
    expect(after.body.lastError).toContain('1件');
    expect(after.headers['cache-control']).toBe('no-store');
  });

  test('failed scans never publish a completion', async () => {
    const controller = createCorosAutoImport({ settingsPath: path.join(root, 'settings.json'), scan: async () => { throw new Error('save failed'); }, onError: jest.fn() });
    await controller.start();
    await controller.stop();
    expect(await controller.getStatus()).toMatchObject({ completionSequence: 0, completions: [], lastError: 'save failed' });
  });

  test('FIT revision is stable across import paths and ignores generated timestamps', () => {
    expect(fitRevision({ fitSha256: 'ABC' })).toBe(fitRevision({ fitSha256: 'abc', importedAt: 'later' }));
    expect(fitRevision({ chartData: [1] })).not.toBe(fitRevision({ chartData: [2] }));
  });

  test('route-only repairs and temporary unavailable comments never announce completion', () => {
    const item = { date: '2026-09-21', labelId: '123', revision: 'fit:one' };
    const completed = completedImports({ imported: [
      { ...item, applied: false },
      { ...item, applied: { notificationReady: false } },
      { ...item, applied: { notificationReady: true } },
    ] }, { imported: [{ ...item, activityId: '456', notificationReady: false }] });
    expect(completed).toEqual([run()]);
  });
});

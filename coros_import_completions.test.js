const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { createCorosImportCompletions, fitRevision, completedImports, extractMinuteObservation } = require('./coros_import_completions');
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

  test.each([
    ['総合分析。\n\n1分毎テーブル所見: 後半は速度と心拍が上昇しました。', '後半は速度と心拍が上昇しました。'],
    ['総合分析。\r\n\r\n**1分毎テーブル所見:**\r\n後半は速度が上昇し、\r\n心拍も連動しました。\r\n\r\n次回の助言。', '後半は速度が上昇し、 心拍も連動しました。'],
    ['## 1分毎テーブル所見： ピッチは安定しました。\n## 次回\n軽く走りましょう。', 'ピッチは安定しました。'],
    ['1分毎テーブル所見: データなし', 'データなし'],
    ['総合分析だけ。', ''],
    ['1分毎テーブル所見:', ''],
    ['1分毎テーブル所見:\n\n次回の助言。', ''],
    [undefined, ''],
  ])('extracts only the minute finding from %p', (message, expected) => {
    expect(extractMinuteObservation(message)).toBe(expected);
  });

  test('FIT and inbox findings survive the journal, restart, and status API per RUN', async () => {
    const completed = completedImports({ imported: [{ date: '2026-09-21', labelId: '123', revision: 'fit:one',
      applied: { notificationReady: true, message: '総合分析。\n\n1分毎テーブル所見: FITの所見。' } }] },
    { imported: [{ date: '2026-09-21', activityId: '456', revision: 'overview:two',
      notificationReady: true, message: '1分毎テーブル所見: Inboxの所見。' }] });
    await createCorosImportCompletions(journalPath).record(completed);
    const controller = createCorosAutoImport({ settingsPath: path.join(root, 'settings.json'), scan: jest.fn(), onError: jest.fn() });
    const app = express();
    app.use('/status', createCorosAutoImportRouter(controller));
    const response = await request(app).get('/status').expect(200);
    expect(response.body.completions.map(({ runId, minuteObservation }) => ({ runId, minuteObservation }))).toEqual([
      { runId: '123', minuteObservation: 'FITの所見。' }, { runId: '456', minuteObservation: 'Inboxの所見。' },
    ]);
    await createCorosImportCompletions(journalPath).record(completed);
    expect((await controller.getStatus()).completionSequence).toBe(2);
  });

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

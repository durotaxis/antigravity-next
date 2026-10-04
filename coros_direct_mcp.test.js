const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const express = require('express');
const request = require('supertest');
const { CorosOAuthProvider, createCorosDirectMcp, createCorosDirectRouter, toolData, listActivities, toolArguments, fitUrl, parseActivity, validDate } = require('./coros_direct_mcp');
const { importCorosFit } = require('./coros_fit_importer');

const records = [
  { labelId: '480194369278738634', sportType: 100, startTimestamp: 1788862179, endTimestamp: 1788862200 },
  { labelId: '480194369278738635', sportType: 100, startTimestamp: 1788865779, endTimestamp: 1788865800 }
];
const tools = [
  { name: 'querySportRecords', inputSchema: { type: 'object', properties: { startDate: { type: 'string' }, endDate: { type: 'string' }, limit: { type: 'number' } }, required: ['startDate', 'endDate'] } },
  ...['getActivityDetail', 'queryActivityFitFileDownloadUrls'].map(name => ({ name, inputSchema: {
    type: 'object', properties: { labelId: { type: 'string' }, sportType: { type: 'number' } }, required: ['labelId', 'sportType'] } }))
];
let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'coros-direct-test-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

async function setup({ list = records, applyFailure = false } = {}) {
  const credentials = path.join(root, 'data/coros/oauth/credentials.json');
  await fs.mkdir(path.dirname(credentials), { recursive: true });
  await fs.writeFile(credentials, JSON.stringify({ tokens: { access_token: 'fixture-token' } }));
  const client = { listTools: jest.fn(async () => ({ tools })), close: jest.fn(async () => {}),
    callTool: jest.fn(async ({ name, arguments: args }) => ({ structuredContent:
      name === 'querySportRecords' ? list : name === 'getActivityDetail' ? { labelId: args.labelId, raw: true } :
        { files: [{ labelId: args.labelId, downloadUrl: `https://files.coros.com/${args.labelId}.fit` }] } })) };
  const fetchFn = jest.fn(async url => {
    const a = records.find(record => url.includes(record.labelId));
    const { Encoder } = await import('@garmin/fitsdk');
    const encoder = new Encoder();
    for (let i = 0; i < 20; i++) encoder.onMesg(20, { timestamp: new Date((a.startTimestamp + i) * 1000),
      distance: i * 2, heartRate: 120, cadence: 80, enhancedSpeed: 2, enhancedAltitude: 10,
      positionLat: 425000000 + i, positionLong: 1650000000 + i });
    const bytes = Buffer.from(encoder.close());
    return { ok: true, headers: new Headers(), arrayBuffer: async () => bytes };
  });
  const applied = new Set();
  const applyFit = jest.fn(async (date, id) => {
    const base = path.join(root, 'data/coros');
    const basename = `${date}_${id}`;
    await importCorosFit({ fitPath: path.join(base, 'fit', `${basename}.fit`), metadataPath: path.join(base, 'metadata', `${basename}.json`),
      outputPath: path.join(base, 'intraday', `${basename}.json`), routeOutputPath: path.join(base, 'route', `${basename}.json`) });
    if (applyFailure) throw new Error('comment unavailable');
    applied.add(id);
  });
  return { controller: createCorosDirectMcp({ root, connectClient: async () => client, fetchFn, applyFit, isApplied: async (date, id) => applied.has(id) }),
    client, fetchFn, applyFit };
}

test('two runs keep full string IDs, separate minute/route output, and do not redownload or reapply', async () => {
  const { controller, client, fetchFn, applyFit } = await setup();
  const first = await controller.receive('2026-09-08');
  expect(first.imported).toEqual(records.map(r => r.labelId));
  expect(first.failed).toEqual([]);
  for (const record of records) {
    const route = JSON.parse(await fs.readFile(path.join(root, 'data/coros/route', `2026-09-08_${record.labelId}.json`)));
    expect(route.runId).toBe(record.labelId);
    expect(route.points).toHaveLength(20);
  }
  expect((await controller.receive('2026-09-08')).skipped).toEqual(first.imported);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(applyFit).toHaveBeenCalledTimes(2);
  expect(client.close).toHaveBeenCalledTimes(2);
});

test('failed application retries despite existing minute output; FIT is reused', async () => {
  const { controller, fetchFn, applyFit } = await setup({ applyFailure: true });
  expect((await controller.receive('2026-09-08')).failed).toHaveLength(2);
  expect((await controller.receive('2026-09-08')).failed).toHaveLength(2);
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(applyFit).toHaveBeenCalledTimes(4);
});

test('truncated nested list stops before any file or summary write', async () => {
  const { controller, fetchFn, applyFit } = await setup({ list: { data: { records, total: 3 } } });
  await expect(controller.receive('2026-09-08')).rejects.toThrow('途中');
  expect(fetchFn).not.toHaveBeenCalled();
  expect(applyFit).not.toHaveBeenCalled();
});

test('empty day is a normal no-op; unknown response is not', async () => {
  const { controller, fetchFn } = await setup({ list: [] });
  expect(await controller.receive('2026-09-08')).toEqual({ date: '2026-09-08', imported: [], skipped: [], failed: [] });
  expect(fetchFn).not.toHaveBeenCalled();
  const unknown = await setup({ list: { unexpected: [] } });
  await expect(unknown.controller.receive('2026-09-08')).rejects.toThrow('未対応');
});

const liveReport = 'Sport Records — 2026-10-03 to 2026-10-03 (1 records)\n========================\n\n1. Outdoor Run — 2026-10-03\n   Location: 東京 ラン\n   Start Coordinates: 35.702999, 139.783997\n   Time Window: startTimestamp=1791008057 | endTimestamp=1791012470\n   Duration: 1:13:32 | Distance: 7.54 km\n   Average Pace: 9:45 /km | Avg HR: 125 bpm | Calories: 452 kcal\n   LabelId: 480771254784131273 | SportType: 100';

test.each([liveReport, JSON.stringify(liveReport)])('live report text decodes and preserves the full activity ID', text => {
  const result = toolData({ content: [{ type: 'text', text }] }, true);
  expect(listActivities(result, '2026-10-03')).toEqual([{ labelId: '480771254784131273', sportType: 100, startTimestamp: 1791008057, endTimestamp: 1791012470 }]);
});

test('text report accepts only explicit zero records and rejects incomplete or unknown reports', () => {
  expect(listActivities('No sport records found from 2020-01-01 to 2020-01-01.', '2020-01-01')).toEqual([]);
  expect(() => listActivities('No sport records found from 2020-01-01 to 2020-01-01.', '2026-10-03')).toThrow('一致');
  expect(listActivities('Sport Records — 2026-10-03 to 2026-10-03 (0 records)\n========================', '2026-10-03')).toEqual([]);
  expect(() => listActivities('No activities found')).toThrow('未対応');
  expect(() => listActivities(liveReport.replace('(1 records)', '(2 records)'))).toThrow('途中');
  expect(() => listActivities(liveReport.replace('   Time Window:', '   Missing:'))).toThrow('必須');
  expect(() => listActivities(liveReport, '2026-10-02')).toThrow('一致');
  expect(() => toolData({ content: [{ type: 'text', text: liveReport }] })).toThrow('構造化JSON');
});

test.each([[false, '1:13:32'], [true, '1:13:32'], [false, '39:49'], [true, '39:49']])('receive handles the complete text response flow (JSON encoded: %s, workout time: %s)', async (encoded, workoutTime) => {
  const { controller, client, fetchFn, applyFit } = await setup();
  const report = 'Sport Records — 2026-09-08 to 2026-09-08 (2 records)\n========================\n\n' + records.map((r, i) => `${i + 1}. Outdoor Run — 2026-09-08\n   Time Window: startTimestamp=${r.startTimestamp} | endTimestamp=${r.endTimestamp}\n   LabelId: ${r.labelId} | SportType: ${r.sportType}`).join('\n\n');
  const detail = `🏃 Outdoor Run Activity Details\n========================================\n\nWorkout Time: ${workoutTime}\nDistance: 7.54 km\nTotal Time: ${workoutTime}\nAverage Heart Rate: 125 bpm`;
  client.callTool.mockImplementation(({ name, arguments: args }) => {
    const text = name === 'querySportRecords' ? report : name === 'getActivityDetail' ? detail :
      `Activity FIT file download URL(s):\n1. ${args.labelId}.fit\n   https://files.coros.com/${args.labelId}.fit`;
    return { content: [{ type: 'text', text: encoded ? JSON.stringify(text) : text }] };
  });
  expect((await controller.receive('2026-09-08')).imported).toEqual(records.map(r => r.labelId));
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(applyFit).toHaveBeenCalledTimes(2);
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'data/coros/metadata', `2026-09-08_${records[0].labelId}.json`), 'utf8'));
  expect(metadata.activityDetails).toEqual({ format: 'coros_mcp_text', text: detail });
  expect((await controller.receive('2026-09-08')).skipped).toEqual(records.map(r => r.labelId));
  expect(fetchFn).toHaveBeenCalledTimes(2);
});

test.each(['unknown detail', 'wrong URL activity', 'multiple URLs', 'untrusted URL'])('invalid text %s fails before FIT download and application', async failure => {
  const { controller, client, fetchFn, applyFit } = await setup({ list: [records[0]] });
  const original = client.callTool.getMockImplementation();
  client.callTool.mockImplementation(args => {
    if (args.name === 'getActivityDetail' && failure === 'unknown detail') return { content: [{ type: 'text', text: 'Service unavailable' }] };
    if (args.name === 'queryActivityFitFileDownloadUrls') {
      const id = failure === 'wrong URL activity' ? records[1].labelId : records[0].labelId;
      const url = failure === 'untrusted URL' ? 'https://coros.com.attacker.example/file.fit' : 'https://files.coros.com/file.fit';
      const extra = failure === 'multiple URLs' ? `\n2. ${records[1].labelId}.fit\n   https://files.coros.com/another.fit` : '';
      return { content: [{ type: 'text', text: `Activity FIT file download URL(s):\n1. ${id}.fit\n   ${url}${extra}` }] };
    }
    return original(args);
  });
  expect((await controller.receive('2026-09-08')).failed).toHaveLength(1);
  expect(fetchFn).not.toHaveBeenCalled();
  expect(applyFit).not.toHaveBeenCalled();
});

test('invalid FIT never reaches metadata or application', async () => {
  const credentials = path.join(root, 'data/coros/oauth/credentials.json');
  await fs.mkdir(path.dirname(credentials), { recursive: true });
  await fs.writeFile(credentials, JSON.stringify({ tokens: { access_token: 'fixture' } }));
  const applyFit = jest.fn();
  const controller = createCorosDirectMcp({ root, applyFit,
    connectClient: async () => ({ listTools: async () => ({ tools }), close: async () => {},
      callTool: async ({ name, arguments: args }) => ({ structuredContent: name === 'querySportRecords' ? [records[0]] :
        name === 'getActivityDetail' ? { labelId: args.labelId } : { labelId: args.labelId, url: 'https://files.coros.com/file.fit' } }) }),
    fetchFn: async () => ({ ok: true, headers: new Headers(), arrayBuffer: async () => Buffer.from('invalid FIT') }) });
  expect((await controller.receive('2026-09-08')).failed).toHaveLength(1);
  expect(applyFit).not.toHaveBeenCalled();
  await expect(fs.access(path.join(root, 'data/coros/metadata', `2026-09-08_${records[0].labelId}.json`))).rejects.toThrow();
});

test('schema changes, unsafe IDs, invalid dates and unrelated FIT URLs fail closed', () => {
  expect(() => toolArguments({ name: 'changed', inputSchema: { properties: { newRequired: {} }, required: ['newRequired'] } }, {})).toThrow('未対応');
  expect(() => parseActivity({ ...records[0], labelId: Number(records[0].labelId) }, '2026-09-08')).toThrow();
  expect(() => parseActivity(records[0], '2026-09-09')).toThrow();
  expect(validDate('2026-02-30')).toBe(false);
  expect(() => fitUrl({ url: 'https://coros.com.attacker.example/file' }, records[0].labelId)).toThrow();
  expect(() => fitUrl({ files: [{ labelId: records[1].labelId, url: 'https://coros.com/file' }] }, records[0].labelId)).toThrow();
});

test('bad OAuth state is rejected before exchange; credentials are not exposed', async () => {
  const { controller } = await setup();
  expect(await controller.status()).toEqual({ connected: true, running: false, redirectUrl: 'http://localhost:3000/api/coros-mcp/callback' });
  await expect(controller.callback('code', 'wrong-state')).rejects.toThrow('確認情報');
  await controller.disconnect();
  expect((await controller.status()).connected).toBe(false);
});

test('provider persists independently with restrictive file permissions and preserves issuer', async () => {
  const file = path.join(root, 'oauth/token.json');
  const provider = new CorosOAuthProvider(file, 'http://localhost:3000/api/coros-mcp/callback');
  await provider.saveTokens({ access_token: 'private', issuer: 'https://mcp.coros.com' });
  const fresh = new CorosOAuthProvider(file, provider.redirectUrl);
  await fresh.load();
  expect(fresh.tokens().issuer).toBe('https://mcp.coros.com');
  if (process.platform !== 'win32') expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  await provider.validateResourceURL('https://mcp.coros.com/mcp', 'https://mcpus.coros.com/mcp');
  expect(provider.data.resourceEndpoint).toBe('https://mcpus.coros.com/mcp');
  await expect(provider.validateResourceURL('https://mcp.coros.com/mcp', 'https://attacker.example/mcp')).rejects.toThrow('Unexpected');
});

test('router rejects cross-site mutations and never returns credentials', async () => {
  const { controller } = await setup();
  const app = express(); app.use(express.json()); app.use('/api/coros-mcp', createCorosDirectRouter(controller));
  await request(app).post('/api/coros-mcp/disconnect').set('Origin', 'https://attacker.example').send({}).expect(403);
  const response = await request(app).get('/api/coros-mcp').expect(200);
  expect(JSON.stringify(response.body)).not.toContain('fixture-token');
  await request(app).get('/api/coros-mcp/callback?code=secret-code&state=wrong').expect(400);
});

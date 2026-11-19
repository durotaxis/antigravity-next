const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { createCorosPushNotifications, createCorosPushRouter } = require('./coros_push_notifications');
const { createCorosDirectRouter } = require('./coros_direct_mcp');
let root;
const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/device-token', keys: {
  p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url'),
} };
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'coros-push-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
function setup() {
  const transport = { generateVAPIDKeys: jest.fn(() => ({ publicKey: 'public', privateKey: 'private' })), sendNotification: jest.fn(async () => {}) };
  const statePath = path.join(root, 'state.json');
  const service = createCorosPushNotifications({ statePath, transport });
  return { service, transport, statePath };
}
function appFor(controller, service) {
  const app = express();
  app.use(express.json());
  app.use('/push', createCorosPushRouter(service));
  app.use('/mcp', createCorosDirectRouter(controller, { notifications: service }));
  return app;
}
const post = (app, url, body) => request(app).post(url).set('Host', 'app.test').set('Origin', 'https://app.test').send(body);

test('keys and subscription persist across restarts; only public key is exposed', async () => {
  const { service, transport, statePath } = setup();
  const id = await service.subscribe(subscription, '/?date=2026-10-31');
  const restarted = createCorosPushNotifications({ statePath, transport });
  await restarted.send(id, { title: 'done' });
  expect(transport.generateVAPIDKeys).toHaveBeenCalledTimes(1);
  expect(JSON.parse(transport.sendNotification.mock.calls[0][1]).url).toBe('/?date=2026-10-31');
  const response = await request(appFor({}, restarted)).get('/push').set('Host', 'app.test').set('Origin', 'https://app.test');
  expect(response.body).toEqual({ publicKey: 'public' });
});

test('expired subscription is removed; transient failure preserves registration for next request', async () => {
  const { service, transport } = setup();
  const id = await service.subscribe(subscription, '/');
  transport.sendNotification.mockRejectedValueOnce({ statusCode: 503 });
  await expect(service.send(id, {})).rejects.toThrow('送信');
  await expect(service.check(id)).resolves.toBeDefined();
  transport.sendNotification.mockRejectedValueOnce({ statusCode: 410 });
  await expect(service.send(id, {})).rejects.toThrow('送信');
  await expect(service.check(id)).rejects.toThrow('有効にし直して');
});

test('untrusted push endpoints and cross-site mutations are rejected', async () => {
  const { service, transport } = setup();
  for (const endpoint of ['https://127.0.0.1/secret', 'https://fcm.googleapis.com.evil.test/x', 'http://fcm.googleapis.com/x']) {
    await expect(service.subscribe({ ...subscription, endpoint }, '/')).rejects.toThrow();
  }
  expect((await request(appFor({}, service)).post('/push/subscribe').set('Origin', 'https://evil.test').send({ subscription, url: '/' })).status).toBe(403);
  expect(transport.sendNotification).not.toHaveBeenCalled();
});

test.each([
  { date: '2026-10-31', imported: ['1'], skipped: [], failed: [] },
  { date: '2026-10-31', imported: ['1'], skipped: [], failed: [{ labelId: '2', error: 'failed' }] },
  { date: '2026-10-31', imported: [], skipped: [], failed: [] },
])('manual receive sends one result to the initiating device: %j', async result => {
  const { service, transport } = setup();
  const id = await service.subscribe(subscription, '/');
  const otherId = await service.subscribe({ ...subscription, endpoint: subscription.endpoint + '-other' }, '/');
  expect(otherId).not.toBe(id);
  const controller = { receive: jest.fn(async () => result) };
  const response = await post(appFor(controller, service), '/mcp/receive', { date: result.date, notificationId: id });
  expect(response.status).toBe(200);
  expect(transport.sendNotification).toHaveBeenCalledTimes(1);
  expect(transport.sendNotification.mock.calls[0][0].endpoint).toBe(subscription.endpoint);
  const payload = JSON.parse(transport.sendNotification.mock.calls[0][1]);
  expect(payload.body).toContain(`失敗 ${result.failed.length}件`);
});

test('failed receive sends failure notification; failed push does not invalidate successful import', async () => {
  const { service, transport } = setup();
  const id = await service.subscribe(subscription, '/');
  const controller = { receive: jest.fn(async () => { throw new Error('COROS unavailable'); }) };
  expect((await post(appFor(controller, service), '/mcp/receive', { date: '2026-10-31', notificationId: id })).status).toBe(400);
  expect(JSON.parse(transport.sendNotification.mock.calls[0][1]).title).toContain('失敗');
  controller.receive.mockResolvedValue({ date: '2026-10-31', imported: ['1'], skipped: [], failed: [] });
  transport.sendNotification.mockRejectedValue({ statusCode: 503 });
  const response = await post(appFor(controller, service), '/mcp/receive', { date: '2026-10-31', notificationId: id });
  expect(response.status).toBe(200);
  expect(response.body.imported).toEqual(['1']);
  expect(response.body.notificationError).toContain('送信');
});

test('unregistered ID stops before ingestion; receiving without notifications remains available', async () => {
  const { service, transport } = setup();
  const controller = { receive: jest.fn(async () => ({ date: '2026-10-31', imported: [], skipped: [], failed: [] })) };
  const app = appFor(controller, service);
  expect((await post(app, '/mcp/receive', { date: '2026-10-31', notificationId: 'unknown' })).status).toBe(400);
  expect(controller.receive).not.toHaveBeenCalled();
  expect((await post(app, '/mcp/receive', { date: '2026-10-31' })).status).toBe(200);
  expect(transport.sendNotification).not.toHaveBeenCalled();
});

test('receive and push continue after the browser disconnects', async () => {
  const http = require('http');
  const { service, transport } = setup();
  const id = await service.subscribe(subscription, '/');
  let finish;
  let started;
  const began = new Promise(resolve => { started = resolve; });
  const controller = { receive: () => { started(); return new Promise(resolve => { finish = resolve; }); } };
  const server = appFor(controller, service).listen(0);
  try {
    const client = http.request({ port: server.address().port, path: '/mcp/receive', method: 'POST', headers: {
      Host: 'app.test', Origin: 'https://app.test', 'Content-Type': 'application/json',
    } });
    client.on('error', () => {});
    client.end(JSON.stringify({ date: '2026-10-31', notificationId: id }));
    await began;
    client.destroy();
    const sent = new Promise(resolve => transport.sendNotification.mockImplementationOnce(async () => { resolve(); }));
    finish({ date: '2026-10-31', imported: ['1'], skipped: [], failed: [] });
    await sent;
    expect(transport.sendNotification).toHaveBeenCalledTimes(1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('forced reception keeps the same background result notification path', async () => {
  const { service, transport } = setup();
  const id = await service.subscribe(subscription, '/');
  const controller = { receive: jest.fn(async () => ({ date: '2026-10-31', imported: ['1'], skipped: [], failed: [] })) };
  const response = await post(appFor(controller, service), '/mcp/receive', { date: '2026-10-31', force: true, notificationId: id });
  expect(response.status).toBe(200);
  expect(controller.receive).toHaveBeenCalledWith('2026-10-31', { force: true });
  expect(transport.sendNotification).toHaveBeenCalledTimes(1);
});

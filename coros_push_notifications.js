const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const webPush = require('web-push');

function validateSubscription(value) {
  const url = new URL(value?.endpoint);
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !(host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
        host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com'))) {
    throw new Error('対応していない通知サービスです。');
  }
  const decode = (key, length) => typeof key === 'string' && /^[\w-]+$/.test(key) && Buffer.from(key, 'base64url').length === length;
  if (!decode(value.keys?.p256dh, 65) || !decode(value.keys?.auth, 16)) throw new Error('通知登録が不正です。');
  return { endpoint: url.href, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

function createCorosPushNotifications({ statePath, transport = webPush,
  subject = process.env.WEB_PUSH_SUBJECT || 'mailto:notifications@antigravity.local' }) {
  let state;
  let queue = Promise.resolve();
  const save = async next => {
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    const temp = `${statePath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      await fs.rename(temp, statePath);
      state = next;
    } finally { await fs.unlink(temp).catch(() => {}); }
  };
  const transaction = fn => {
    const result = queue.then(async () => {
      if (!state) {
        try {
          state = JSON.parse(await fs.readFile(statePath, 'utf8'));
          if (state.version !== 1 || !state.vapid?.publicKey || !state.vapid?.privateKey || !state.subscriptions) {
            state = undefined;
            throw new Error('通知設定ファイルが不正です。');
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await save({ version: 1, vapid: transport.generateVAPIDKeys(), subscriptions: {} });
        }
      }
      return fn();
    });
    queue = result.catch(() => {});
    return result;
  };
  const get = id => transaction(() => {
    const entry = typeof id === 'string' && Object.hasOwn(state.subscriptions, id) ? state.subscriptions[id] : null;
    if (!entry) throw new Error('携帯通知を有効にし直してください。');
    return { entry, vapid: { ...state.vapid } };
  });
  return {
    publicKey: () => transaction(() => state.vapid.publicKey),
    async subscribe(subscription, url) {
      const clean = validateSubscription(subscription);
      if (typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) throw new Error('通知先の画面が不正です。');
      return transaction(async () => {
        // Stable for the same endpoint; callers must possess the full subscription.
        const id = crypto.createHash('sha256').update(clean.endpoint).digest('hex');
        await save({ ...state, subscriptions: { ...state.subscriptions, [id]: { subscription: clean, url } } });
        return id;
      });
    },
    check: get,
    remove: id => transaction(async () => {
      const subscriptions = { ...state.subscriptions };
      delete subscriptions[id];
      await save({ ...state, subscriptions });
    }),
    async send(id, message) {
      const { entry, vapid } = await get(id);
      try {
        await transport.sendNotification(entry.subscription, JSON.stringify({ ...message, url: entry.url }), {
          vapidDetails: { subject, ...vapid }, TTL: 86400, timeout: 10000,
          ...(process.env.HTTPS_PROXY ? { proxy: process.env.HTTPS_PROXY } : {}),
        });
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) await this.remove(id);
        throw new Error('携帯通知を送信できませんでした。通知設定とサーバーの通信を確認してください。');
      }
    },
  };
}

function createCorosPushRouter(service) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method === 'GET') return next();
    try {
      if (!req.get('Origin') || new URL(req.get('Origin')).hostname !== req.hostname ||
          (req.method !== 'GET' && !req.is('application/json'))) return res.status(403).json({ error: 'アプリ画面から操作してください。' });
    } catch { return res.status(403).json({ error: 'Invalid origin' }); }
    next();
  });
  const handle = fn => async (req, res) => {
    try { await fn(req, res); } catch (error) { res.status(400).json({ error: error.message }); }
  };
  router.get('/', handle(async (req, res) => res.json({ publicKey: await service.publicKey() })));
  router.post('/subscribe', handle(async (req, res) => res.json({ id: await service.subscribe(req.body?.subscription, req.body?.url) })));
  router.post('/unsubscribe', handle(async (req, res) => { await service.remove(req.body?.id); res.json({ enabled: false }); }));
  router.post('/test', handle(async (req, res) => {
    await service.send(req.body?.id, { title: 'AntiGravity 通知テスト', body: '画面を閉じていても受信結果を通知できます。', tag: `coros-test-${crypto.randomUUID()}` });
    res.json({ accepted: true });
  }));
  return router;
}
module.exports = { createCorosPushNotifications, createCorosPushRouter, validateSubscription };

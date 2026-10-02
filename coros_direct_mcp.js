// Independent COROS OAuth client. Never reads the Codex/ChatGPT credentials.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { auth, UnauthorizedError } = require('@modelcontextprotocol/sdk/client/auth.js');
const { decodeFitRecords } = require('./coros_fit_importer');
const { atomicWrite, jst, activity } = require('./tools/coros_sync_runner');

const ENDPOINT = 'https://mcp.coros.com/mcp';
const SCOPE = 'openid offline_access mcp.tools';
const safeError = error => String(error?.message || error).replace(/https?:\/\/\S+/g, '[URL]').slice(0, 300);

class CorosOAuthProvider {
  constructor(file, redirectUrl) { this.file = file; this.redirectUrl = redirectUrl; this.data = {}; }
  async load() {
    try { this.data = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(this.data), { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, this.file);
    } finally { await fs.unlink(temp).catch(() => {}); }
  }
  get clientMetadata() {
    return { client_name: 'AntiGravity Run Comment', redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: SCOPE };
  }
  state() {
    if (!this.data.pending) throw new UnauthorizedError('COROSへの再接続が必要です。');
    return this.data.pending.state;
  }
  clientInformation() { return this.data.clientInformation; }
  async saveClientInformation(value) { this.data.clientInformation = value; await this.save(); }
  tokens() { return this.data.tokens; }
  async saveTokens(value) { this.data.tokens = value; await this.save(); }
  redirectToAuthorization(url) { this.authorizationUrl = url.toString(); }
  async saveCodeVerifier(value) { this.data.verifier = value; await this.save(); }
  codeVerifier() {
    if (!this.data.verifier) throw new Error('COROS認証を最初からやり直してください。');
    return this.data.verifier;
  }
  async invalidateCredentials(scope) {
    if (scope === 'all') this.data = {};
    if (scope === 'client') delete this.data.clientInformation;
    if (scope === 'tokens') delete this.data.tokens;
    if (scope === 'verifier') delete this.data.verifier;
    await this.save();
  }
  async validateResourceURL(serverUrl, resource) {
    // COROS documents automatic regional routing. The SDK otherwise rejects
    // mcpus.coros.com metadata when connecting through mcp.coros.com.
    const url = new URL(resource || serverUrl);
    if (url.protocol !== 'https:' || !['mcp.coros.com', 'mcpus.coros.com', 'mcpeu.coros.com', 'mcpcn.coros.com'].includes(url.hostname) ||
        url.pathname !== '/mcp' || url.port || url.username || url.password || url.search || url.hash) {
      throw new Error('Unexpected COROS OAuth resource');
    }
    this.data.resourceEndpoint = url.toString();
    await this.save();
    return url;
  }
}

function toolData(result) {
  if (result?.isError) throw new Error('COROS MCPがエラーを返しました。再接続または日付を確認してください。');
  if (result?.structuredContent) return result.structuredContent;
  const texts = (result?.content || []).filter(item => item.type === 'text').map(item => item.text);
  for (const text of texts) { try { return JSON.parse(text); } catch {} }
  throw new Error('COROSの応答が構造化JSONではありません。取込を停止しました。');
}

// Bind only fields actually advertised by the live MCP schema, including defaults.
function toolArguments(tool, values) {
  if (!tool) throw new Error('必要なCOROS MCPツールがありません。');
  const schema = tool.inputSchema;
  const result = {};
  for (const [key, definition] of Object.entries(schema?.properties || {})) {
    if (Object.hasOwn(values, key)) result[key] = values[key];
    else if (definition.default !== undefined) result[key] = definition.default;
    else if ((schema.required || []).includes(key)) throw new Error(`COROSツールの未対応必須項目: ${tool.name}.${key}`);
  }
  return result;
}

function listEnvelope(data) {
  if (data?.data && !Array.isArray(data.data) && typeof data.data === 'object') return listEnvelope(data.data);
  return data;
}

function listActivities(data) {
  if (Array.isArray(data)) return data;
  for (const key of ['records', 'activities', 'sportRecords', 'list', 'items']) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  if (data?.data && data.data !== data) return listActivities(data.data);
  throw new Error('COROS活動一覧の形式が未対応です。空の一覧とは扱いません。');
}

function parseActivity(record, date) {
  // Large COROS IDs must arrive as strings, never rounded JS numbers.
  const a = activity({ labelId: record.labelId, sportType: Number(record.sportType),
    startTimestamp: record.startTimestamp, endTimestamp: record.endTimestamp });
  if (a.endTimestamp == null) throw new Error('COROS活動の終了時刻がありません。');
  if (a.date !== date) throw new Error('指定日とCOROS活動の開始日が一致しません。');
  return a;
}

function fitUrl(data, labelId) {
  const matches = [];
  const walk = value => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== 'object') return;
    if (value.labelId != null && String(value.labelId) !== labelId) return;
    for (const [key, item] of Object.entries(value)) {
      if (['url', 'downloadUrl', 'fitUrl', 'fitFileUrl', 'fitFileDownloadUrl'].includes(key) && typeof item === 'string') matches.push(item);
      else if (item && typeof item === 'object') walk(item);
    }
  };
  walk(data);
  const urls = [...new Set(matches)];
  if (urls.length !== 1) throw new Error('活動のFIT URLを一意に特定できません。');
  const url = new URL(urls[0]);
  if (url.protocol !== 'https:' || !/(^|\.)coros\.com$/i.test(url.hostname) || url.username || url.password) {
    throw new Error('公式COROS HTTPS URL以外のFIT取得を停止しました。');
  }
  return url.toString();
}

function validDate(date) {
  return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
}

function createCorosDirectMcp({ root = __dirname, redirectUrl = process.env.COROS_REDIRECT_URI || 'http://localhost:3000/api/coros-mcp/callback',
  applyFit, isApplied = async () => false, connectClient, fetchFn = fetch, validateFit = decodeFitRecords } = {}) {
  const callbackUrl = new URL(redirectUrl);
  if (callbackUrl.pathname !== '/api/coros-mcp/callback' ||
      (callbackUrl.protocol !== 'https:' && !(callbackUrl.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(callbackUrl.hostname)))) {
    throw new Error('COROS_REDIRECT_URI must use HTTPS or loopback HTTP and /api/coros-mcp/callback');
  }
  const provider = new CorosOAuthProvider(path.join(root, 'data/coros/oauth/credentials.json'), redirectUrl);
  let loaded;
  let running = false;
  let authenticating = false;
  const initialize = () => loaded ||= provider.load();
  const openClient = connectClient || (async () => {
    const client = new Client({ name: 'antigravity-run-comment', version: '1.0.0' });
    // Use the discovered regional resource to avoid stripping Bearer credentials
    // on a cross-origin redirect from the generic routing endpoint.
    const endpoint = await provider.validateResourceURL(ENDPOINT, provider.data.resourceEndpoint || ENDPOINT);
    const transport = new StreamableHTTPClientTransport(endpoint, { authProvider: provider });
    try { await client.connect(transport); return client; }
    catch (error) { await transport.close().catch(() => {}); throw error; }
  });
  const status = async () => {
    await initialize();
    return { connected: Boolean(provider.data.tokens?.access_token), running, redirectUrl };
  };
  const begin = async () => {
    await initialize();
    if (running || authenticating) throw new Error('COROSの処理が実行中です。');
    authenticating = true;
    try {
      delete provider.data.tokens;
      provider.data.pending = { state: crypto.randomBytes(32).toString('hex'), createdAt: Date.now() };
      provider.authorizationUrl = null;
      await provider.save();
      await auth(provider, { serverUrl: ENDPOINT, scope: SCOPE });
      if (!provider.authorizationUrl) throw new Error('COROS認証画面のURLを取得できませんでした。');
      return { authorizationUrl: provider.authorizationUrl };
    } finally { authenticating = false; }
  };
  const callback = async (code, state) => {
    await initialize();
    const pending = provider.data.pending;
    if (!pending || typeof state !== 'string' || state.length !== pending.state.length ||
        !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(pending.state)) || Date.now() - pending.createdAt > 10 * 60 * 1000 ||
        typeof code !== 'string' || !code) throw new Error('認証の有効期限または確認情報が不正です。接続をやり直してください。');
    if (authenticating || running) throw new Error('COROSの処理が実行中です。');
    authenticating = true;
    try {
      delete provider.data.pending; // Consume before exchange; callback cannot be replayed.
      await provider.save();
      await auth(provider, { serverUrl: ENDPOINT, authorizationCode: code, scope: SCOPE });
      delete provider.data.verifier;
      await provider.save();
    } finally { authenticating = false; }
  };
  const disconnect = async () => {
    await initialize();
    if (running || authenticating) throw new Error('COROSの処理が実行中です。');
    await provider.invalidateCredentials('all');
  };
  const receive = async date => {
    if (!validDate(date)) throw new Error('有効な日付を指定してください。');
    await initialize();
    if (!provider.data.tokens?.access_token) throw new UnauthorizedError('COROSに接続してください。');
    if (running || authenticating || provider.data.pending) throw new Error('COROSの処理または認証が実行中です。');
    running = true;
    let client;
    const result = { date, imported: [], skipped: [], failed: [] };
    try {
      client = await openClient();
      const tools = new Map();
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        page.tools.forEach(tool => tools.set(tool.name, tool));
        cursor = page.nextCursor;
      } while (cursor);
      const call = async (name, values) => toolData(await client.callTool({ name, arguments: toolArguments(tools.get(name), values) }));
      const list = await call('querySportRecords', { startDate: date.replaceAll('-', ''), endDate: date.replaceAll('-', ''),
        sportTypeCodes: [100, 101, 102, 103], limit: 100, timezone: 'Asia/Tokyo',
        minDistanceKm: 0, maxDistanceKm: 0, minDurationMinutes: 0, maxDurationMinutes: 0, maxAveragePace: '', locationKeyword: '' });
      const records = listActivities(list);
      // Do not silently ingest a partial day if the server caps its response.
      const envelope = listEnvelope(list);
      if (records.length >= 100 || envelope.hasMore === true || envelope.nextCursor || Number(envelope.total ?? envelope.totalCount ?? records.length) > records.length) {
        throw new Error('活動一覧が途中で切れています。全件取得できないため取込を停止しました。');
      }
      const activities = records.map(record => parseActivity(record, date)).sort((a, b) => a.startTimestamp - b.startTimestamp);
      if (new Set(activities.map(a => a.labelId)).size !== activities.length) throw new Error('活動IDが重複しています。');
      let downloads = 0;
      for (const a of activities) {
        try {
          const basename = `${a.date}_${a.labelId}`;
          const fitPath = path.join(root, 'data/coros/fit', `${basename}.fit`);
          const metadataPath = path.join(root, 'data/coros/metadata', `${basename}.json`);
          let bytes;
          let metadata;
          try {
            bytes = await fs.readFile(fitPath);
            metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            const hash = crypto.createHash('sha256').update(bytes).digest('hex');
            if (metadata.source !== 'coros_fit' || metadata.labelId !== a.labelId || metadata.date !== a.date ||
                metadata.sportType !== a.sportType || Date.parse(metadata.startTime) !== a.startTimestamp * 1000 ||
                Date.parse(metadata.endTime) !== a.endTimestamp * 1000 || metadata.fitSha256 !== hash) throw new Error('Existing FIT pair mismatch');
            await validateFit(fitPath);
          } catch (error) {
            if (error.code && error.code !== 'ENOENT') throw error;
            bytes = null;
          }
          if (!bytes) {
            if (++downloads > 50) throw new Error('今回のFIT取得上限50件に達しました。');
            const values = { labelId: a.labelId, labelIds: [a.labelId], sportType: a.sportType,
              startTimestamp: a.startTimestamp, endTimestamp: a.endTimestamp, startDate: date.replaceAll('-', ''), endDate: date.replaceAll('-', ''), timezone: 'Asia/Tokyo' };
            const details = await call('getActivityDetail', values);
            const url = fitUrl(await call('queryActivityFitFileDownloadUrls', values), a.labelId);
            const response = await fetchFn(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
            if (!response.ok) throw new Error(`FIT取得に失敗しました (${response.status})。`);
            if (Number(response.headers.get('content-length') || 0) > 32 * 1024 * 1024) throw new Error('FITが最大サイズを超えています。');
            bytes = Buffer.from(await response.arrayBuffer());
            if (bytes.length > 32 * 1024 * 1024) throw new Error('FITが最大サイズを超えています。');
            const temp = `${fitPath}.${crypto.randomUUID()}.tmp`;
            await fs.mkdir(path.dirname(fitPath), { recursive: true });
            try {
              await fs.writeFile(temp, bytes, { flag: 'wx' });
              await validateFit(temp);
              await fs.rename(temp, fitPath);
            } finally { await fs.unlink(temp).catch(() => {}); }
            await atomicWrite(metadataPath, { source: 'coros_fit', labelId: a.labelId, sportType: a.sportType, date: a.date,
              startTime: jst(a.startTimestamp * 1000), endTime: jst(a.endTimestamp * 1000), originalFitPath: fitPath,
              fitSha256: crypto.createHash('sha256').update(bytes).digest('hex'), fitSizeBytes: bytes.length,
              downloadedAt: new Date().toISOString(), activityDetails: details });
          }
          const outputPath = path.join(root, 'data/coros/intraday', `${basename}.json`);
          const routePath = path.join(root, 'data/coros/route', `${basename}.json`);
          let ready = false;
          if (bytes && metadata) {
            try {
              const output = JSON.parse(await fs.readFile(outputPath, 'utf8'));
              await fs.access(routePath);
              ready = output.labelId === a.labelId && output.fitSha256 === metadata.fitSha256 && await isApplied(date, a.labelId);
            } catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
          }
          if (ready) result.skipped.push(a.labelId);
          else {
            await applyFit(date, a.labelId);
            result.imported.push(a.labelId);
          }
        } catch (error) { result.failed.push({ labelId: a.labelId, error: safeError(error) }); }
      }
      return result;
    } finally { await client?.close().catch(() => {}); running = false; }
  };
  return { status, begin, callback, disconnect, receive };
}

function createCorosDirectRouter(controller) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    if (req.method === 'GET') return next();
    // JSON + same hostname prevents cross-site requests to a LAN/local app.
    try {
      if (!req.is('application/json') || !req.get('Origin') || new URL(req.get('Origin')).hostname !== req.hostname) {
        return res.status(403).json({ error: 'アプリ画面から操作してください。' });
      }
    } catch { return res.status(403).json({ error: 'Invalid origin' }); }
    next();
  });
  const handle = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) { res.status(error instanceof UnauthorizedError ? 401 : 400).json({ error: safeError(error) }); }
  };
  router.get('/', handle(async (req, res) => res.json(await controller.status())));
  router.post('/connect', handle(async (req, res) => res.json(await controller.begin())));
  router.post('/disconnect', handle(async (req, res) => { await controller.disconnect(); res.json({ connected: false }); }));
  router.post('/receive', handle(async (req, res) => res.json(await controller.receive(req.body?.date))));
  router.get('/callback', async (req, res) => {
    try {
      if (req.query.error) throw new Error('COROS認証がキャンセルされました。');
      await controller.callback(req.query.code, req.query.state);
      res.type('html').send('<!doctype html><html lang="ja"><meta charset="utf-8"><title>COROS接続完了</title><p>COROS接続が完了しました。この画面を閉じ、アプリで「接続状態を確認」を押してください。</p></html>');
    } catch { res.status(400).type('text').send('COROS接続を完了できませんでした。アプリで接続をやり直してください。'); }
  });
  return router;
}

module.exports = { CorosOAuthProvider, createCorosDirectMcp, createCorosDirectRouter, toolData, toolArguments, listActivities, parseActivity, fitUrl, validDate };

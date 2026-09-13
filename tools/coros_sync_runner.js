// Scheduled COROS sync: the agent calls MCP; this process owns all local writes.
const fs = require('fs/promises');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const os = require('os');
const { decodeFitRecords } = require('../coros_fit_importer');

const DEFAULT_ROOT = path.resolve(__dirname, '..');
const LIMIT_MS = 240000;
const jst = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().replace('Z', '+09:00');
const parse = text => JSON.parse(text.replace(/^\uFEFF/, ''));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safeError = error => String(error?.message || error).replace(/https?:\/\/\S+/gi, '[URL]').slice(0, 500);
const pipeName = root => {
  const name = `coros-sync-${hash(path.resolve(root).toLowerCase()).slice(0, 20)}`;
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `${name}.sock`);
};
async function readJson(file, missing) {
  try { return parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return missing; throw error; }
}
async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp.${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temp, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    await fs.rename(temp, file);
  } finally { await fs.unlink(temp).catch(() => {}); }
}
function activity(value) {
  if (!value || typeof value.labelId !== 'string' || !/^\d+$/.test(value.labelId) ||
      ![100, 101, 102, 103].includes(value.sportType) ||
      !Number.isSafeInteger(value.startTimestamp) || value.startTimestamp < 946684800 ||
      value.startTimestamp > Math.floor(Date.now() / 1000) + 300) throw new Error('Invalid activity identity or Unix seconds');
  const date = jst(value.startTimestamp * 1000).slice(0, 10);
  if (value.date && value.date !== date) throw new Error('Activity date differs from JST start date');
  if (value.endTimestamp != null && (!Number.isSafeInteger(value.endTimestamp) || value.endTimestamp < value.startTimestamp || value.endTimestamp > Math.floor(Date.now() / 1000) + 300)) throw new Error('Invalid endTimestamp');
  return { labelId: value.labelId, sportType: value.sportType, date, startTimestamp: value.startTimestamp, ...(value.endTimestamp != null ? { endTimestamp: value.endTimestamp } : {}) };
}
function compare(a, b) {
  return a.startTimestamp - b.startTimestamp || (BigInt(a.labelId) < BigInt(b.labelId) ? -1 : BigInt(a.labelId) > BigInt(b.labelId) ? 1 : 0);
}
function validateState(state) {
  if (!state || Array.isArray(state) || state.version !== 2) throw new Error('Invalid state version; refusing reset');
  for (const key of ['updatedAt', 'lastSuccessfulListCheckAt', 'lastSuccessfulSyncAt', 'lastAttemptAt']) {
    if (state[key] != null && (typeof state[key] !== 'string' || !Number.isFinite(Date.parse(state[key])))) throw new Error(`Invalid state ${key}`);
  }
  if (state.lastImportedActivity != null) activity(state.lastImportedActivity);
  if (state.consecutiveFailures != null && (!Number.isSafeInteger(state.consecutiveFailures) || state.consecutiveFailures < 0)) throw new Error('Invalid failure count');
  return state;
}
class SyncRun {
  constructor(root = DEFAULT_ROOT, memoryPath) {
    this.root = path.resolve(root);
    this.statePath = path.join(this.root, 'data/run-comment/state/coros-sync-state.json');
    this.historyPath = path.join(path.dirname(this.statePath), 'coros-sync-history.json');
    this.memoryPath = memoryPath || path.join(os.homedir(), '.codex/automations/coros-run-run-comment/memory.md');
    this.startedMs = Date.now();
    this.counts = { imported: 0, repaired: 0, skipped: 0 };
    this.index = 0;
    this.stage = 'state';
    this.abort = new AbortController();
  }
  guard() {
    if (this.closed || this.abort.signal.aborted || Date.now() - this.startedMs >= LIMIT_MS) throw new Error('Sync deadline exceeded or session closed');
  }
  async start() {
    this.state = validateState(await readJson(this.statePath, { version: 2, lastSuccessfulListCheckAt: null, lastImportedActivity: null, updatedAt: null }));
    this.state.lastAttemptAt = jst(this.startedMs);
    this.state.updatedAt = jst();
    this.state.lastRunStatus = 'running';
    await atomicWrite(this.statePath, this.state);
    const cursor = this.state.lastImportedActivity;
    return { deadlineAt: jst(this.startedMs + LIMIT_MS), boundary: cursor, query: {
      startDate: (cursor ? jst(cursor.startTimestamp * 1000).slice(0, 10) : jst(this.startedMs).slice(0, 10)).replaceAll('-', ''),
      endDate: jst(this.startedMs).slice(0, 10).replaceAll('-', ''),
      sportTypeCodes: [100, 101, 102, 103], limit: 100, timezone: 'Asia/Tokyo',
      minDistanceKm: 0, maxDistanceKm: 0, minDurationMinutes: 0, maxDurationMinutes: 0, maxAveragePace: '', locationKeyword: ''
    } };
  }
  paths(a) {
    const base = `${a.date}_${a.labelId}`;
    return { fit: path.join(this.root, 'data/coros/fit', base + '.fit'), meta: path.join(this.root, 'data/coros/metadata', base + '.json') };
  }
  async inspect(a) {
    const p = this.paths(a);
    let bytes;
    try { bytes = await fs.readFile(p.fit); }
    catch (error) { if (error.code === 'ENOENT') return { action: 'download', existed: false }; throw error; }
    try { await decodeFitRecords(p.fit); }
    catch (error) {
      if (error.code) throw error;
      return { action: 'download', existed: true };
    }
    let meta;
    try { meta = await readJson(p.meta, null); }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    const valid = meta && meta.source === 'coros_fit' && meta.labelId === a.labelId && meta.sportType === a.sportType &&
      meta.date === a.date && typeof meta.originalFitPath === 'string' && path.resolve(meta.originalFitPath).toLowerCase() === p.fit.toLowerCase() &&
      meta.fitSizeBytes === bytes.length && String(meta.fitSha256).toLowerCase() === hash(bytes) &&
      Number.isFinite(Date.parse(meta.startTime)) && Date.parse(meta.startTime) === a.startTimestamp * 1000 &&
      Number.isFinite(Date.parse(meta.endTime)) && Date.parse(meta.endTime) >= Date.parse(meta.startTime) &&
      meta.activityDetails && typeof meta.activityDetails === 'object' && !Array.isArray(meta.activityDetails);
    return { action: valid ? 'skip' : 'metadata', existed: true, bytes, meta };
  }
  async checkpoint(a) {
    this.guard();
    const previous = this.state.lastImportedActivity;
    if (!previous || compare(a, previous) > 0) {
      this.state.lastImportedActivity = { labelId: a.labelId, sportType: a.sportType, date: a.date, startTimestamp: a.startTimestamp };
      this.state.updatedAt = jst();
      await atomicWrite(this.statePath, this.state);
    }
  }
  async plan(records, complete) {
    this.guard();
    this.stage = 'list';
    if (this.queue || complete !== true || !Array.isArray(records)) throw new Error('A complete activity list must be supplied once');
    const seen = new Map();
    const boundary = this.state.lastImportedActivity?.startTimestamp;
    const firstDay = boundary == null ? jst(this.startedMs).slice(0, 10) : jst(boundary * 1000).slice(0, 10);
    for (const raw of records) {
      const a = activity(raw);
      if (a.date < firstDay || a.date > jst(this.startedMs).slice(0, 10)) throw new Error('Activity outside requested date range');
      if (boundary != null && a.startTimestamp < boundary) continue;
      if (seen.has(a.labelId) && JSON.stringify(seen.get(a.labelId)) !== JSON.stringify(a)) throw new Error('Conflicting duplicate activity');
      seen.set(a.labelId, a);
    }
    this.queue = [...seen.values()].sort(compare);
    this.state.lastSuccessfulListCheckAt = jst();
    this.state.updatedAt = jst();
    await atomicWrite(this.statePath, this.state);
    return this.next();
  }
  async next() {
    this.guard();
    while (this.index < this.queue.length) {
      this.current = this.queue[this.index];
      this.stage = 'verify';
      this.inspection = await this.inspect(this.current);
      if (this.inspection.action !== 'skip') return { action: this.inspection.action, activity: this.current };
      await this.checkpoint(this.current); // Recover a crash after file commit but before cursor commit.
      this.counts.skipped++;
      this.index++;
    }
    this.current = null;
    return { action: 'finish', counts: this.counts };
  }
  async download(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !/(^|\.)coros\.com$/i.test(parsed.hostname) || parsed.username || parsed.password) throw new Error('Expected a COROS HTTPS FIT URL');
    for (let attempt = 0; attempt < 3; attempt++) {
      this.guard();
      try {
        const response = await fetch(url, { signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30000)]), redirect: 'error' });
        if (!response.ok) {
          const error = new Error(`FIT download HTTP ${response.status}`);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        return Buffer.from(await response.arrayBuffer());
      } catch (error) {
        const retryable = error.retryable === true || error.name === 'TimeoutError' || (error instanceof TypeError && error.message === 'fetch failed');
        if (!retryable || attempt === 2 || this.abort.signal.aborted) throw error;
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 1000));
      }
    }
  }
  async commit(input) {
    this.guard();
    if (!this.current || input.labelId !== this.current.labelId) throw new Error('Commit does not match pending activity');
    const a = this.current;
    if (!input.activityDetails || typeof input.activityDetails !== 'object' || Array.isArray(input.activityDetails)) throw new Error('activityDetails must preserve the actual MCP detail response');
    if (a.endTimestamp == null) throw new Error('Missing endTimestamp; do not infer activity times');
    const p = this.paths(a);
    let bytes = this.inspection.bytes;
    this.stage = this.inspection.action === 'download' ? 'download' : 'metadata';
    if (this.inspection.action === 'download') bytes = await this.download(input.downloadUrl);
    await fs.mkdir(path.dirname(p.fit), { recursive: true });
    const temp = `${p.fit}.tmp.${crypto.randomUUID()}`;
    try {
      await fs.writeFile(temp, bytes, { flag: 'wx' });
      this.stage = 'fit-validation';
      await decodeFitRecords(temp);
      this.guard();
      if (this.inspection.action === 'download') await fs.rename(temp, p.fit);
      this.stage = 'metadata-save';
      await atomicWrite(p.meta, {
        source: 'coros_fit', labelId: a.labelId, sportType: a.sportType, date: a.date,
        startTime: jst(a.startTimestamp * 1000), endTime: jst(a.endTimestamp * 1000), originalFitPath: p.fit,
        fitSha256: hash(bytes), fitSizeBytes: bytes.length,
        downloadedAt: this.inspection.action === 'metadata' ? (this.inspection.meta?.downloadedAt || null) : jst(),
        metadataUpdatedAt: jst(), activityDetails: input.activityDetails
      });
      if ((await this.inspect(a)).action !== 'skip') throw new Error('Post-save validation failed');
      this.stage = 'cursor-save';
      await this.checkpoint(a);
      this.counts[this.inspection.existed ? 'repaired' : 'imported']++;
      this.index++;
      return await this.next();
    } finally { await fs.unlink(temp).catch(() => {}); }
  }
  async finish(error = null) {
    if (this.closed) throw new Error('Session already closed');
    if (!error && (!this.queue || this.index !== this.queue.length)) error = new Error('Incomplete sync cannot finish successfully');
    this.closed = true;
    const endedAt = jst();
    const summary = { startedAt: jst(this.startedMs), endedAt, status: error ? 'failed' : 'success', ...this.counts,
      error: error ? { stage: this.stage, labelId: this.current?.labelId || null, message: safeError(error) } : null };
    const recordingErrors = [];
    if (this.state) {
      this.state.updatedAt = endedAt;
      this.state.lastRunStatus = summary.status;
      this.state.lastError = summary.error;
      this.state.consecutiveFailures = error ? (this.state.consecutiveFailures || 0) + 1 : 0;
      if (!error) this.state.lastSuccessfulSyncAt = endedAt;
      try { await atomicWrite(this.statePath, this.state); } catch (e) { recordingErrors.push('state: ' + safeError(e)); }
    }
    try {
      const history = await readJson(this.historyPath, []);
      if (!Array.isArray(history)) throw new Error('Invalid history format');
      await atomicWrite(this.historyPath, [...history, summary].slice(-50));
    } catch (e) { recordingErrors.push('history: ' + safeError(e)); }
    try {
      await atomicWrite(this.memoryPath, [
        `状態: ${error ? 'FIT同期失敗' : 'FIT同期成功'}`,
        `今回の開始: ${summary.startedAt}`, `今回の終了: ${endedAt}`,
        `一覧の最終確認: ${this.state?.lastSuccessfulListCheckAt || '未確認'}`,
        `最終FIT取込: ${JSON.stringify(this.state?.lastImportedActivity || null)}`,
        '設定間隔: 5分', `新規取込件数: ${this.counts.imported}`, `修復件数: ${this.counts.repaired}`,
        `検証済みスキップ件数: ${this.counts.skipped}`, `エラー件数: ${error ? 1 : 0}`,
        `次回再試行対象: ${error ? this.current?.labelId || '一覧取得／状態確認' : 'なし'}`,
        `エラー: ${JSON.stringify(summary.error)}`, `記録エラー: ${recordingErrors.join('; ') || 'なし'}`
      ].join('\n') + '\n');
    } catch (e) { recordingErrors.push('memory: ' + safeError(e)); }
    return { ...summary, recordingErrors, ok: !error && recordingErrors.length === 0 };
  }
}

// One named-pipe listener owns the whole run, including time spent waiting on MCP.
// The OS releases the listener on process exit; no persistent lock file is needed.
async function serve(root, memoryPath) {
  const run = new SyncRun(root, memoryPath);
  const token = crypto.randomUUID();
  let chain = Promise.resolve();
  let ready = false;
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(120000, () => socket.destroy());
    let data = '';
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 5 * 1024 * 1024) return socket.destroy();
      if (!data.includes('\n')) return;
      socket.removeAllListeners('data');
      chain = chain.then(async () => {
        let request;
        try { request = JSON.parse(data.slice(0, data.indexOf('\n'))); }
        catch { return socket.end(JSON.stringify({ ok: false, error: 'Invalid request JSON' }) + '\n'); }
        if (!ready || request.token !== token) return socket.end(JSON.stringify({ ok: false, error: 'Invalid session token or not ready' }) + '\n');
        let result;
        try {
          run.guard();
          if (request.command === 'plan') result = await run.plan(request.activities, request.complete);
          else if (request.command === 'commit') result = await run.commit(request);
          else if (request.command === 'finish') result = await run.finish();
          else if (request.command === 'fail') { run.stage = request.stage || 'mcp'; result = await run.finish(new Error(request.error || 'MCP failed')); }
          else throw new Error('Unknown command');
          socket.end(JSON.stringify({ ok: true, result }) + '\n');
        } catch (error) {
          result = run.closed ? { ok: false, error: safeError(error) } : await run.finish(error);
          socket.end(JSON.stringify({ ok: false, result }) + '\n');
        }
        if (run.closed) stop(result?.ok === true ? 0 : 1);
      }).catch(error => { console.error(safeError(error)); stop(1); });
    });
  });
  let timer;
  const stop = code => {
    clearTimeout(timer);
    server.close();
    process.exitCode = code;
    // Let the final client response flush before releasing any idle clients.
    setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 100).unref();
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(pipeName(root), resolve); });
  } catch (error) {
    if (error.code === 'EADDRINUSE') { console.log(JSON.stringify({ status: 'busy', reason: 'Another sync owns the named pipe' })); return; }
    throw error;
  }
  try {
    const initial = await run.start();
    ready = true;
    console.log(JSON.stringify({ status: 'ready', token, ...initial }));
    timer = setTimeout(() => {
      run.abort.abort();
      chain = chain.then(async () => {
        if (!run.closed) console.log(JSON.stringify(await run.finish(new Error('240-second sync deadline exceeded'))));
        stop(1);
      });
    }, Math.max(1, LIMIT_MS - (Date.now() - run.startedMs)));
  } catch (error) {
    console.error(JSON.stringify(await run.finish(error)));
    stop(1);
  }
}
async function request(root, payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeName(root));
    let data = '';
    socket.setTimeout(115000, () => socket.destroy(new Error('Helper request timed out')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify(payload) + '\n'));
    socket.on('data', chunk => { data += chunk.toString(); });
    socket.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
  });
}
if (require.main === module) {
  const [command, input, rootArg] = process.argv.slice(2);
  const root = path.resolve(rootArg || DEFAULT_ROOT);
  (async () => {
    if (command === 'start') return serve(root);
    if (command === 'request' && input) {
      const result = await request(root, await readJson(path.resolve(input)));
      console.log(JSON.stringify(result));
      if (!result.ok || result.result?.ok === false) process.exitCode = 1;
      return;
    }
    throw new Error('Usage: node tools/coros_sync_runner.js start | request <UTF-8 JSON file>');
  })().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
}
module.exports = { SyncRun, activity, compare, jst, atomicWrite, validateState, serve, request, pipeName };

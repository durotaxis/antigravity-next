const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const vm = require('node:vm');
const sqlite3 = require('sqlite3').verbose();
const code = fs.readFileSync('repo.js', 'utf8');
let db, file, apply;
const run = sql => new Promise((resolve, reject) => db.exec(sql, e => e ? reject(e) : resolve()));
const get = sql => new Promise((resolve, reject) => db.get(sql, (e, row) => e ? reject(e) : resolve(row)));

beforeEach(async () => {
  file = path.join(os.tmpdir(), `run-confirmation-${crypto.randomUUID()}.db`);
  db = await new Promise((resolve, reject) => {
    const connection = new sqlite3.Database(file, e => e ? reject(e) : resolve(connection));
  });
  await run(`CREATE TABLE run_messages(date TEXT, run_id TEXT, message TEXT, created_at TEXT, PRIMARY KEY(date,run_id));
    CREATE TABLE daily_summary(date TEXT PRIMARY KEY, message TEXT, created_at TEXT, total_distance_km REAL);
    INSERT INTO run_messages VALUES('2026-11-23','first','confirmed','old');
    INSERT INTO run_messages VALUES('2026-11-23','second','other run','old');
    INSERT INTO daily_summary VALUES('2026-11-23','confirmed','old',7.5);`);
  const context = { sqlite3, db: { databasePath: file }, toTextOrNull: value => String(value || '').trim() || null };
  vm.runInNewContext(code.slice(code.indexOf('function applyRunComment('), code.indexOf('function getRunMessage(')), context);
  apply = context.applyRunComment;
});

afterEach(async () => {
  if (db) await new Promise((resolve, reject) => db.close(e => e ? reject(e) : resolve()));
  if (file && fs.existsSync(file)) fs.unlinkSync(file);
});

test('confirmation saves chosen candidate to both messages without changing metrics or another run', async () => {
  await apply({ date: '2026-11-23', run_id: 'first', message: 'chosen candidate' });
  expect(await get("SELECT message FROM run_messages WHERE run_id='first'")).toEqual({ message: 'chosen candidate' });
  expect(await get('SELECT message,total_distance_km FROM daily_summary')).toEqual({ message: 'chosen candidate', total_distance_km: 7.5 });
  expect(await get("SELECT message FROM run_messages WHERE run_id='second'")).toEqual({ message: 'other run' });
});

test('daily write failure rolls back the run write and preserves both confirmed messages', async () => {
  await run("CREATE TRIGGER fail_daily BEFORE UPDATE ON daily_summary BEGIN SELECT RAISE(ABORT, 'test write failure'); END;");
  await expect(apply({ date: '2026-11-23', run_id: 'first', message: 'candidate' })).rejects.toThrow('test write failure');
  expect(await get("SELECT message FROM run_messages WHERE run_id='first'")).toEqual({ message: 'confirmed' });
  expect(await get('SELECT message,total_distance_km FROM daily_summary')).toEqual({ message: 'confirmed', total_distance_km: 7.5 });
});

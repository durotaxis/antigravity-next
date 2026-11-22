// Exercise the real SQLite repository methods against an isolated in-memory DB.
// Neither the single settings key nor its table references a date or a run ID.
jest.mock('./db', () => {
  const sqlite3 = require('sqlite3').verbose();
  return new sqlite3.Database(':memory:');
});

const db = require('./db');
const repo = require('./repo');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
      if (error) reject(error);
      else resolve(this.changes);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
  });
}

beforeAll(async () => {
  await run(`CREATE TABLE app_settings (
    setting_key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`);
  await run('CREATE TABLE run_messages (date TEXT, run_id TEXT, message TEXT)');
  await run('CREATE TABLE daily_summary (date TEXT PRIMARY KEY, message TEXT)');
});
afterAll(async () => {
  await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
});

test('one global setting survives reads/writes without creating run links', async () => {
  expect(await repo.getRunCommentPrefix()).toBe('');
  await run("INSERT INTO run_messages (date,run_id,message) VALUES ('2026-11-22','123','original')");
  await run("INSERT INTO daily_summary (date,message) VALUES ('2026-11-22','original')");
  await repo.saveRunCommentPrefix('追加指示A');
  expect(await repo.getRunCommentPrefix()).toBe('追加指示A');
  await repo.saveRunCommentPrefix('追加指示B');
  expect(await repo.getRunCommentPrefix()).toBe('追加指示B');

  expect(await get("SELECT COUNT(*) AS n FROM app_settings")).toEqual({ n: 1 });
  expect(await get("SELECT setting_key, value FROM app_settings"))
    .toEqual({ setting_key: 'gemini.run_comment_prefix', value: '追加指示B' });
  expect(await get("SELECT message FROM run_messages WHERE run_id = '123'")).toEqual({ message: 'original' });
  expect(await get("SELECT message FROM daily_summary WHERE date = '2026-11-22'")).toEqual({ message: 'original' });

  await repo.saveRunCommentPrefix('');
  expect(await repo.getRunCommentPrefix()).toBe('');
  expect(await get('SELECT COUNT(*) AS n FROM app_settings')).toEqual({ n: 1 });
});

test('invalid database schema does not silently fall back to a JSON file', async () => {
  await run('DROP TABLE app_settings');
  await expect(repo.getRunCommentPrefix()).rejects.toThrow(/no such table/);
  await expect(repo.saveRunCommentPrefix('text')).rejects.toThrow(/no such table/);
});

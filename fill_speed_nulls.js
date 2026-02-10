const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.resolve(__dirname, 'daily.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not connect to database at', dbPath, err);
    process.exitCode = 1;
  } else {
    console.log(`Connected to database: ${dbPath}`);
  }
});

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

(async () => {
  try {
    const avgChanges = await run('UPDATE daily_summary SET avg_speed = 0 WHERE avg_speed IS NULL;');
    const maxChanges = await run('UPDATE daily_summary SET max_speed = 0 WHERE max_speed IS NULL;');
    console.log(`Updated avg_speed NULL -> 0: ${avgChanges} rows`);
    console.log(`Updated max_speed NULL -> 0: ${maxChanges} rows`);
  } catch (err) {
    console.error('Failed to fill speed NULLs:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();


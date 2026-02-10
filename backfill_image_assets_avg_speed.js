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

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this.changes);
    });
  });
}

function parseHours(totalTime) {
  const parts = String(totalTime || '').split(':').map(Number);
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  if (parts.length === 3) return parts[0] + parts[1] / 60 + parts[2] / 3600;
  if (parts.length === 2) return parts[0] / 60 + parts[1] / 3600;
  return 0;
}

(async () => {
  try {
    const rows = await all(
      `SELECT asset_id, total_distance, total_time FROM image_assets WHERE avg_speed IS NULL OR avg_speed = 0 ORDER BY asset_id ASC;`
    );
    console.log(`Candidates: ${rows.length}`);

    let updated = 0;
    for (const row of rows) {
      const distanceKm = Number(row.total_distance);
      const hours = parseHours(row.total_time);
      if (!Number.isFinite(distanceKm) || distanceKm <= 0 || hours <= 0) continue;

      const avgSpeed = Number((distanceKm / hours).toFixed(1));
      if (!Number.isFinite(avgSpeed) || avgSpeed <= 0) continue;

      updated += await run(`UPDATE image_assets SET avg_speed = ? WHERE asset_id = ?;`, [
        avgSpeed,
        row.asset_id
      ]);
    }

    console.log(`Updated rows: ${updated}`);
  } catch (err) {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();


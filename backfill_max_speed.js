const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const googleFitService = require('./google_fit_service');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.resolve(__dirname, 'daily.db');

const CACHE_DIR = path.join(__dirname, 'storage', 'cache');
const allowApi = process.env.ALLOW_API_BACKFILL === '1';

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

function computeMaxSpeedFromBuckets(buckets) {
  let maxSpeed = 0;

  for (const bucket of buckets || []) {
    let bucketDistance = 0;
    for (const ds of bucket.dataset || []) {
      const sourceId = ds.dataSourceId || '';
      if (!sourceId.includes('distance')) continue;
      for (const p of ds.point || []) {
        for (const v of p.value || []) {
          bucketDistance += (v.fpVal || 0);
        }
      }
    }

    if (bucketDistance > 0) {
      // 1-minute bucket assumption: speed(km/h) = distance(m) * 0.06
      const speed = Number((bucketDistance * 0.06).toFixed(1));
      if (Number.isFinite(speed) && speed > maxSpeed) maxSpeed = speed;
    }
  }

  return maxSpeed;
}

async function readRawBuckets(dateString) {
  const rawCacheFile = path.join(CACHE_DIR, `raw_buckets_${dateString}.json`);
  const json = await fs.readFile(rawCacheFile, 'utf8');
  return JSON.parse(json);
}

(async () => {
  const stats = {
    candidates: 0,
    updated: 0,
    skippedNoData: 0,
    skippedNoCache: 0,
    apiUpdated: 0,
    errors: 0
  };

  try {
    const rows = await all(
      `SELECT date FROM daily_summary WHERE max_speed IS NULL OR max_speed = 0 ORDER BY date ASC;`
    );

    stats.candidates = rows.length;
    console.log(`Candidates (max_speed NULL/0): ${stats.candidates}`);

    for (const row of rows) {
      const date = row.date;
      let maxSpeed = 0;

      try {
        const buckets = await readRawBuckets(date);
        maxSpeed = computeMaxSpeedFromBuckets(buckets);
      } catch (e) {
        if (e.code === 'ENOENT') {
          stats.skippedNoCache++;
        } else {
          console.warn(`[${date}] Failed to read/parse cache: ${e.message}`);
          stats.errors++;
        }
      }

      if (maxSpeed <= 0 && allowApi) {
        try {
          const fit = await googleFitService.getDailyMetrics(date);
          maxSpeed = (fit && Number.isFinite(Number(fit.max_speed))) ? Number(fit.max_speed) : 0;
          if (maxSpeed > 0) stats.apiUpdated++;
        } catch (e) {
          console.warn(`[${date}] API backfill failed: ${e.message}`);
          stats.errors++;
        }
      }

      if (maxSpeed > 0) {
        const changes = await run(`UPDATE daily_summary SET max_speed = ? WHERE date = ?;`, [maxSpeed, date]);
        stats.updated += changes;
      } else {
        stats.skippedNoData++;
      }
    }

    console.log('--- Backfill Summary ---');
    console.log(`Updated rows: ${stats.updated}`);
    console.log(`Skipped (still 0): ${stats.skippedNoData}`);
    console.log(`Missing cache files: ${stats.skippedNoCache}`);
    console.log(`API-updated dates: ${stats.apiUpdated} (requires ALLOW_API_BACKFILL=1)`);
    console.log(`Errors: ${stats.errors}`);
  } catch (err) {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();


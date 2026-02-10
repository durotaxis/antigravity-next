const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs').promises;
require('dotenv').config();

const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.resolve(__dirname, 'daily.db');

const CACHE_DIR = path.join(__dirname, 'storage', 'cache');

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

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

function avgSpeedFromRawBuckets(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) return 0;

  let sumSpeedAny = 0;
  let countSpeedAny = 0;
  let sumSpeedRun = 0;
  let countSpeedRun = 0;

  for (const bucket of buckets) {
    let bucketDistance = 0;
    let bucketIsRun = false;

    for (const ds of bucket.dataset || []) {
      const sourceId = ds.dataSourceId || '';

      if (sourceId.includes('activity.segment')) {
        for (const p of ds.point || []) {
          for (const v of p.value || []) {
            if (v.intVal === 8) bucketIsRun = true;
          }
        }
      }

      if (sourceId.includes('activity.summary')) {
        for (const p of ds.point || []) {
          const typeVal = p.value && p.value[0] ? p.value[0].intVal : null;
          if (typeVal === 8) bucketIsRun = true;
        }
      }

      if (!sourceId.includes('distance')) continue;
      for (const p of ds.point || []) {
        for (const v of p.value || []) bucketDistance += (v.fpVal || 0);
      }
    }

    if (bucketDistance > 0) {
      const speed = Number((bucketDistance * 0.06).toFixed(1));
      if (Number.isFinite(speed) && speed > 0) {
        sumSpeedAny += speed;
        countSpeedAny++;
        if (bucketIsRun) {
          sumSpeedRun += speed;
          countSpeedRun++;
        }
      }
    }
  }

  const avgAny = countSpeedAny > 0 ? Number((sumSpeedAny / countSpeedAny).toFixed(1)) : 0;
  const avgRun = countSpeedRun > 0 ? Number((sumSpeedRun / countSpeedRun).toFixed(1)) : 0;
  return avgRun > 0 ? avgRun : avgAny;
}

function avgSpeedFromIntraday(points) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  let sumSpeed = 0;
  let countSpeed = 0;
  for (const p of points) {
    const speed = Number(p?.speed);
    if (!Number.isFinite(speed) || speed <= 0) continue;
    sumSpeed += speed;
    countSpeed++;
  }
  return countSpeed > 0 ? Number((sumSpeed / countSpeed).toFixed(1)) : 0;
}

async function computeAvgSpeed(dateString) {
  const rawBucketsFile = path.join(CACHE_DIR, `raw_buckets_${dateString}.json`);
  const buckets = await readJsonIfExists(rawBucketsFile);
  const fromRaw = avgSpeedFromRawBuckets(buckets);
  if (fromRaw > 0) return { avgSpeed: fromRaw, source: 'raw_buckets' };

  const intradayFile = path.join(CACHE_DIR, `intraday_${dateString}.json`);
  const points = await readJsonIfExists(intradayFile);
  const fromIntraday = avgSpeedFromIntraday(points);
  if (fromIntraday > 0) return { avgSpeed: fromIntraday, source: 'intraday' };

  return null;
}

(async () => {
  const stats = {
    candidates: 0,
    updatedRows: 0,
    skippedNoCache: 0,
    errors: 0
  };

  try {
    const rows = await all(
      `SELECT date, avg_speed
       FROM daily_summary
       WHERE avg_speed IS NULL OR avg_speed = 0
       ORDER BY date ASC;`
    );

    stats.candidates = rows.length;
    console.log(`Candidates (avg_speed NULL/0): ${stats.candidates}`);

    for (const row of rows) {
      const date = row.date;
      const computed = await computeAvgSpeed(date).catch((e) => {
        console.warn(`[${date}] Cache parse failed: ${e.message}`);
        stats.errors++;
        return null;
      });

      if (!computed) {
        stats.skippedNoCache++;
        continue;
      }

      const nextAvg = computed.avgSpeed;
      if (!(nextAvg > 0)) continue;

      const changes = await run(
        `UPDATE daily_summary
         SET avg_speed = CASE WHEN avg_speed IS NULL OR avg_speed = 0 THEN ? ELSE avg_speed END
         WHERE date = ?;`,
        [nextAvg, date]
      );
      stats.updatedRows += changes;
    }

    const remaining = await all(
      `SELECT SUM(CASE WHEN avg_speed IS NULL OR avg_speed = 0 THEN 1 ELSE 0 END) AS avg_missing
       FROM daily_summary;`
    );

    console.log('--- Backfill Summary ---');
    console.log(`Updated rows: ${stats.updatedRows}`);
    console.log(`Skipped (no cache): ${stats.skippedNoCache}`);
    console.log(`Errors: ${stats.errors}`);
    if (remaining && remaining[0]) console.log(`Remaining avg_speed missing: ${remaining[0].avg_missing}`);
  } catch (err) {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();

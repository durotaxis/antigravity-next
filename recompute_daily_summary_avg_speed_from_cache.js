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

function computeAvgSpeedFromRawBuckets(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) return 0;

  let sumSpeedAny = 0;
  let countSpeedAny = 0;
  let sumSpeedRun = 0;
  let countSpeedRun = 0;
  let seenRun = 0;

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

    if (bucketIsRun) seenRun++;

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

  // If we saw any run buckets but computed 0, fall back to avgAny.
  return avgRun > 0 ? avgRun : avgAny;
}

function computeAvgSpeedFromIntraday(points) {
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
  const fromRaw = computeAvgSpeedFromRawBuckets(buckets);
  if (fromRaw > 0) return fromRaw;

  const intradayFile = path.join(CACHE_DIR, `intraday_${dateString}.json`);
  const points = await readJsonIfExists(intradayFile);
  const fromIntraday = computeAvgSpeedFromIntraday(points);
  if (fromIntraday > 0) return fromIntraday;

  return 0;
}

(async () => {
  const stats = {
    rows: 0,
    updated: 0,
    skippedNoCache: 0,
    errors: 0
  };

  try {
    const rows = await all(`SELECT date, avg_speed FROM daily_summary ORDER BY date ASC;`);
    stats.rows = rows.length;
    console.log(`Rows: ${stats.rows}`);

    for (const row of rows) {
      const date = row.date;
      const current = Number(row.avg_speed || 0);
      const computed = await computeAvgSpeed(date).catch((e) => {
        console.warn(`[${date}] Cache parse failed: ${e.message}`);
        stats.errors++;
        return 0;
      });

      if (!(computed > 0)) {
        stats.skippedNoCache++;
        continue;
      }

      // Update if missing or clearly off. (We already backfilled once; fix the bad ones.)
      const shouldUpdate =
        !(current > 0) ||
        current < computed * 0.6 ||
        current > computed * 1.4;

      if (!shouldUpdate) continue;

      const changes = await run(`UPDATE daily_summary SET avg_speed = ? WHERE date = ?;`, [computed, date]);
      stats.updated += changes;
    }

    console.log('--- Recompute Summary ---');
    console.log(`Updated rows: ${stats.updated}`);
    console.log(`Skipped (computed 0): ${stats.skippedNoCache}`);
    console.log(`Errors: ${stats.errors}`);
  } catch (err) {
    console.error('Recompute failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();


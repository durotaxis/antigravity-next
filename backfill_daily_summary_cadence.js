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

function cadenceFromRawBuckets(buckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) return null;

  let maxCadence = 0;
  let sumCadence = 0;
  let countCadence = 0;

  for (const bucket of buckets) {
    let bucketSteps = 0;
    for (const ds of bucket.dataset || []) {
      const sourceId = ds.dataSourceId || '';
      if (!sourceId.includes('step_count')) continue;
      for (const p of ds.point || []) {
        for (const v of p.value || []) {
          bucketSteps += (v.intVal || 0);
        }
      }
    }

    if (bucketSteps > 0) {
      if (bucketSteps > maxCadence) maxCadence = bucketSteps;
      sumCadence += bucketSteps;
      countCadence++;
    }
  }

  const avgCadence = countCadence > 0 ? Math.round(sumCadence / countCadence) : 0;
  return { avgCadence, maxCadence, points: buckets.length, nonzero: countCadence };
}

function cadenceFromIntraday(points) {
  if (!Array.isArray(points) || points.length === 0) return null;

  let maxCadence = 0;
  let sumCadence = 0;
  let countCadence = 0;

  for (const p of points) {
    const steps = Number(p?.steps);
    if (!Number.isFinite(steps) || steps <= 0) continue;
    if (steps > maxCadence) maxCadence = steps;
    sumCadence += steps;
    countCadence++;
  }

  const avgCadence = countCadence > 0 ? Math.round(sumCadence / countCadence) : 0;
  return { avgCadence, maxCadence, points: points.length, nonzero: countCadence };
}

async function computeCadenceForDate(dateString) {
  const rawBucketsFile = path.join(CACHE_DIR, `raw_buckets_${dateString}.json`);
  const buckets = await readJsonIfExists(rawBucketsFile);
  const fromRaw = cadenceFromRawBuckets(buckets);
  if (fromRaw) return { ...fromRaw, source: 'raw_buckets' };

  const intradayFile = path.join(CACHE_DIR, `intraday_${dateString}.json`);
  const points = await readJsonIfExists(intradayFile);
  const fromIntraday = cadenceFromIntraday(points);
  if (fromIntraday) return { ...fromIntraday, source: 'intraday' };

  return null;
}

(async () => {
  const stats = {
    candidates: 0,
    updatedRows: 0,
    updatedAvg: 0,
    updatedMax: 0,
    skippedNoCache: 0,
    errors: 0
  };

  try {
    const rows = await all(
      `SELECT date, avg_cadence, max_cadence
       FROM daily_summary
       WHERE avg_cadence IS NULL OR avg_cadence = 0 OR max_cadence IS NULL OR max_cadence = 0
       ORDER BY date ASC;`
    );

    stats.candidates = rows.length;
    console.log(`Candidates (avg/max cadence NULL/0): ${stats.candidates}`);

    for (const row of rows) {
      const date = row.date;
      const computed = await computeCadenceForDate(date).catch((e) => {
        console.warn(`[${date}] Cache parse failed: ${e.message}`);
        stats.errors++;
        return null;
      });

      if (!computed) {
        stats.skippedNoCache++;
        continue;
      }

      const existingAvg = Number(row.avg_cadence || 0);
      const existingMax = Number(row.max_cadence || 0);

      // "Avg: screenshot priority" means: keep existing non-zero avg_cadence.
      const nextAvg = existingAvg > 0 ? existingAvg : (computed.avgCadence > 0 ? computed.avgCadence : 0);
      // "Max: align to 1-min" means: prefer raw bucket max (our compute uses raw if available).
      const nextMax = existingMax > 0 ? existingMax : (computed.maxCadence > 0 ? computed.maxCadence : 0);

      if (nextAvg === existingAvg && nextMax === existingMax) continue;

      const changes = await run(
        `UPDATE daily_summary
         SET
           avg_cadence = CASE WHEN avg_cadence IS NULL OR avg_cadence = 0 THEN ? ELSE avg_cadence END,
           max_cadence = CASE WHEN max_cadence IS NULL OR max_cadence = 0 THEN ? ELSE max_cadence END
         WHERE date = ?;`,
        [nextAvg, nextMax, date]
      );

      stats.updatedRows += changes;
      if (existingAvg <= 0 && nextAvg > 0) stats.updatedAvg++;
      if (existingMax <= 0 && nextMax > 0) stats.updatedMax++;
    }

    const remaining = await all(
      `SELECT
         SUM(CASE WHEN avg_cadence IS NULL OR avg_cadence = 0 THEN 1 ELSE 0 END) AS avg_missing,
         SUM(CASE WHEN max_cadence IS NULL OR max_cadence = 0 THEN 1 ELSE 0 END) AS max_missing
       FROM daily_summary;`
    );

    console.log('--- Backfill Summary ---');
    console.log(`Updated rows: ${stats.updatedRows}`);
    console.log(`Updated avg_cadence: ${stats.updatedAvg}`);
    console.log(`Updated max_cadence: ${stats.updatedMax}`);
    console.log(`Skipped (no cache): ${stats.skippedNoCache}`);
    console.log(`Errors: ${stats.errors}`);
    if (remaining && remaining[0]) {
      console.log(`Remaining avg missing: ${remaining[0].avg_missing}`);
      console.log(`Remaining max missing: ${remaining[0].max_missing}`);
    }
  } catch (err) {
    console.error('Backfill failed:', err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();


const fs = require('fs');
const path = require('path');
const repo = require('./repo');
const db = require('./db');

const CACHE_DIR = path.join(__dirname, 'storage', 'cache');

function getAllRunDates() {
  return new Promise((resolve, reject) => {
    db.all('SELECT date, max_stride, avg_stride FROM daily_summary ORDER BY date ASC', (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function hasAnyImageLink(runId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT 1 AS ok FROM run_images WHERE run_id = ? LIMIT 1', [runId], (err, row) => {
      if (err) return reject(err);
      resolve(Boolean(row && row.ok));
    });
  });
}

function computeStrideFromIntraday(dateString) {
  const filePath = path.join(CACHE_DIR, `intraday_${dateString}.json`);
  if (!fs.existsSync(filePath)) return null;

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }

  if (!raw) return null;

  let points;
  try {
    points = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(points) || points.length === 0) return null;

  let sumStride = 0;
  let countStride = 0;
  let maxStride = 0;

  for (const p of points) {
    const stride = Number(p?.stride);
    // Match google_fit_service cleaning: stride > 250 is invalid.
    if (!Number.isFinite(stride) || stride <= 0 || stride > 250) continue;
    sumStride += stride;
    countStride++;
    if (stride > maxStride) maxStride = stride;
  }

  if (countStride === 0) return null;

  return {
    avg_stride: Number((sumStride / countStride).toFixed(1)),
    max_stride: Number(maxStride.toFixed(1))
  };
}

async function main() {
  const rows = await getAllRunDates();
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const date = row.date;
    if (!date) continue;

    const computed = computeStrideFromIntraday(date);
    if (!computed) {
      skipped++;
      continue;
    }

    const currentMax = Number(row.max_stride || 0);
    const currentAvg = Number(row.avg_stride || 0);

    // If a screenshot exists, we still repair clearly invalid values (>250 or 0).
    // Otherwise we freely recompute from cache.
    const hasImg = await hasAnyImageLink(date);

    const shouldUpdateMax = (!hasImg && computed.max_stride > 0) || (currentMax === 0) || (currentMax > 250);
    const shouldUpdateAvg = (!hasImg && computed.avg_stride > 0) || (currentAvg === 0) || (currentAvg > 250);

    if (!shouldUpdateMax && !shouldUpdateAvg) {
      skipped++;
      continue;
    }

    const payload = { date };
    if (shouldUpdateMax) payload.max_stride = computed.max_stride;
    if (shouldUpdateAvg) payload.avg_stride = computed.avg_stride;

    await repo.saveDailySummary(payload);
    updated++;
  }

  console.log(`Done. updated=${updated} skipped=${skipped} rows=${rows.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


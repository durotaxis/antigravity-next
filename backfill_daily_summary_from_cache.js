const path = require('path');
const fs = require('fs').promises;
const db = require('./db');
const repo = require('./repo');

function secondsToHms(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseHmsToSeconds(hms) {
  if (!hms) return 0;
  const parts = String(hms).trim().split(':').map(p => Number(p));
  if (parts.some(p => !Number.isFinite(p))) return 0;
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  return 0;
}

function pickPositive(preferred, fallback) {
  const a = Number(preferred);
  if (Number.isFinite(a) && a > 0) return a;
  const b = Number(fallback);
  return Number.isFinite(b) && b > 0 ? b : 0;
}

function pickText(preferred, fallback) {
  const a = preferred === null || preferred === undefined ? '' : String(preferred).trim();
  if (a.length > 0) return a;
  const b = fallback === null || fallback === undefined ? '' : String(fallback).trim();
  return b.length > 0 ? b : null;
}

async function computeDerivedFromIntradayCache(dateString) {
  try {
    const rawBucketsFile = path.join(__dirname, 'storage', 'cache', `raw_buckets_${dateString}.json`);

    let rawMaxSpeed = 0;
    let rawAvgSpeed = 0;
    let rawMaxPitch = 0;
    let rawAvgPitch = 0;
    let rawPoints = 0;

    try {
      const rawBuckets = await fs.readFile(rawBucketsFile, 'utf8');
      const buckets = JSON.parse(rawBuckets);
      if (Array.isArray(buckets) && buckets.length > 0) {
        rawPoints = buckets.length;

        let sumSpeedAny = 0;
        let countSpeedAny = 0;
        let sumPitchAny = 0;
        let countPitchAny = 0;
        let maxSpeedAny = 0;
        let maxPitchAny = 0;

        let sumSpeedRun = 0;
        let countSpeedRun = 0;
        let sumPitchRun = 0;
        let countPitchRun = 0;
        let maxSpeedRun = 0;
        let maxPitchRun = 0;

        for (const bucket of buckets) {
          let bucketSteps = 0;
          let bucketDistance = 0;
          let bucketIsRun = false;

          for (const ds of bucket.dataset || []) {
            const sourceId = ds.dataSourceId || '';

            if (sourceId.includes('activity.segment') || sourceId.includes('activity.summary')) {
              for (const p of ds.point || []) {
                for (const v of p.value || []) {
                  if (v.intVal === 8) bucketIsRun = true;
                }
              }
            }

            for (const p of ds.point || []) {
              for (const v of p.value || []) {
                if (sourceId.includes('step_count')) bucketSteps += (v.intVal || 0);
                if (sourceId.includes('distance')) bucketDistance += (v.fpVal || 0);
              }
            }
          }

          if (bucketSteps > 0) {
            if (bucketSteps > maxPitchAny) maxPitchAny = bucketSteps;
            sumPitchAny += bucketSteps;
            countPitchAny++;

            if (bucketIsRun) {
              if (bucketSteps > maxPitchRun) maxPitchRun = bucketSteps;
              sumPitchRun += bucketSteps;
              countPitchRun++;
            }
          }

          if (bucketDistance > 0) {
            const speed = Number((bucketDistance * 0.06).toFixed(1));
            if (Number.isFinite(speed) && speed > 0) {
              if (speed > maxSpeedAny) maxSpeedAny = speed;
              sumSpeedAny += speed;
              countSpeedAny++;

              if (bucketIsRun) {
                if (speed > maxSpeedRun) maxSpeedRun = speed;
                sumSpeedRun += speed;
                countSpeedRun++;
              }
            }
          }
        }

        const avgPitchAny = countPitchAny > 0 ? Math.round(sumPitchAny / countPitchAny) : 0;
        const avgSpeedAny = countSpeedAny > 0 ? Number((sumSpeedAny / countSpeedAny).toFixed(1)) : 0;

        const avgPitchRun = countPitchRun > 0 ? Math.round(sumPitchRun / countPitchRun) : 0;
        const avgSpeedRun = countSpeedRun > 0 ? Number((sumSpeedRun / countSpeedRun).toFixed(1)) : 0;

        rawMaxSpeed = maxSpeedRun > 0 ? maxSpeedRun : maxSpeedAny;
        rawAvgSpeed = avgSpeedRun > 0 ? avgSpeedRun : avgSpeedAny;
        rawMaxPitch = maxPitchRun > 0 ? maxPitchRun : maxPitchAny;
        rawAvgPitch = avgPitchRun > 0 ? avgPitchRun : avgPitchAny;
      }
    } catch {
      // ignore and fall back below
    }

    const intradayFile = path.join(__dirname, 'storage', 'cache', `intraday_${dateString}.json`);

    let intradayAvgSpeed = 0;
    let intradayAvgPitch = 0;
    let intradayMaxSpeed = 0;
    let intradayMaxPitch = 0;
    let intradayPoints = 0;

    try {
      const raw = await fs.readFile(intradayFile, 'utf8');
      const points = JSON.parse(raw);
      if (Array.isArray(points) && points.length > 0) {
        intradayPoints = points.length;
        let sumSpeed = 0;
        let countSpeed = 0;
        let sumPitch = 0;
        let countPitch = 0;

        for (const p of points) {
          const speed = Number(p?.speed);
          if (Number.isFinite(speed) && speed > intradayMaxSpeed) intradayMaxSpeed = speed;
          if (Number.isFinite(speed) && speed > 0) {
            sumSpeed += speed;
            countSpeed++;
          }

          const steps = Number(p?.steps);
          if (Number.isFinite(steps) && steps > 0) {
            if (steps > intradayMaxPitch) intradayMaxPitch = steps;
            sumPitch += steps;
            countPitch++;
          }
        }

        intradayAvgSpeed = countSpeed > 0 ? Number((sumSpeed / countSpeed).toFixed(1)) : 0;
        intradayAvgPitch = countPitch > 0 ? Math.round(sumPitch / countPitch) : 0;
      }
    } catch {
      // ignore
    }

    if (rawPoints === 0 && intradayPoints === 0) return null;

    return {
      json_avg_speed: intradayAvgSpeed > 0 ? intradayAvgSpeed : rawAvgSpeed,
      json_max_speed: rawMaxSpeed > 0 ? Number(rawMaxSpeed.toFixed(1)) : Number(intradayMaxSpeed.toFixed(1)),
      json_avg_pitch: rawAvgPitch > 0 ? rawAvgPitch : intradayAvgPitch,
      json_max_pitch: rawMaxPitch > 0 ? rawMaxPitch : intradayMaxPitch,
      json_points: rawPoints > 0 ? rawPoints : intradayPoints
    };
  } catch {
    return null;
  }
}

async function computeDailySummaryFromCache(dateString) {
  const rawBucketsFile = path.join(__dirname, 'storage', 'cache', `raw_buckets_${dateString}.json`);
  const intradayFile = path.join(__dirname, 'storage', 'cache', `intraday_${dateString}.json`);

  const out = {
    step_count: 0,
    total_distance_km: 0,
    total_time: null,
    calories_kcal: 0,
    avg_stride_cm: 0,
    max_stride_cm: 0,
    avg_heart_rate: 0,
    max_heart_rate: 0,
    avg_speed: 0,
    max_speed: 0,
    avg_cadence: 0,
    max_cadence: 0
  };

  const derived = await computeDerivedFromIntradayCache(dateString);
  if (derived) {
    out.avg_speed = Number(derived.json_avg_speed || 0);
    out.max_speed = Number(derived.json_max_speed || 0);
    out.avg_cadence = Number(derived.json_avg_pitch || 0);
    out.max_cadence = Number(derived.json_max_pitch || 0);
  }

  try {
    const raw = await fs.readFile(rawBucketsFile, 'utf8');
    const buckets = JSON.parse(raw);
    if (Array.isArray(buckets) && buckets.length > 0) {
      const any = { steps: 0, distanceM: 0, activeSec: 0, pointsDistance: 0 };
      const run = { steps: 0, distanceM: 0, activeSec: 0, pointsDistance: 0 };

      for (const bucket of buckets) {
        const datasets = Array.isArray(bucket?.dataset) ? bucket.dataset : [];
        if (datasets.length === 0) continue;

        let bucketSteps = 0;
        let bucketDistance = 0;
        let bucketIsRun = false;

        for (const ds of datasets) {
          const dsid = String(ds?.dataSourceId || '');
          const points = Array.isArray(ds?.point) ? ds.point : [];
          if (points.length === 0) continue;

          if (dsid.includes('activity.segment') || dsid.includes('activity.summary')) {
            for (const p of points) {
              const v = p?.value?.[0];
              const t = Number(v?.intVal);
              if (Number.isFinite(t) && t === 8) bucketIsRun = true;
            }
            continue;
          }

          if (dsid.includes('step_count.delta')) {
            for (const p of points) {
              const v = p?.value?.[0];
              const n = Number(v?.intVal);
              if (Number.isFinite(n) && n > 0) bucketSteps += n;
            }
            continue;
          }

          if (dsid.includes('distance.delta')) {
            for (const p of points) {
              const v = p?.value?.[0];
              const n = Number(v?.fpVal);
              if (Number.isFinite(n) && n > 0) bucketDistance += n;
            }
            continue;
          }

          if (dsid.includes('calories.expended')) {
            for (const p of points) {
              const v = p?.value?.[0];
              const n = Number(v?.fpVal);
              if (Number.isFinite(n) && n > 0) out.calories_kcal += n;
            }
            continue;
          }
        }

        if (bucketSteps > 0) any.steps += bucketSteps;
        if (bucketDistance > 0) {
          any.distanceM += bucketDistance;
          any.pointsDistance++;
        }
        if (bucketDistance > 0 || bucketSteps > 0) any.activeSec += 60;

        if (bucketIsRun) {
          if (bucketSteps > 0) run.steps += bucketSteps;
          if (bucketDistance > 0) {
            run.distanceM += bucketDistance;
            run.pointsDistance++;
          }
          if (bucketDistance > 0 || bucketSteps > 0) run.activeSec += 60;
        }
      }

      const useRun = run.distanceM > 0 && run.activeSec >= 60;
      const picked = useRun ? run : any;

      out.step_count = Math.round(picked.steps);
      out.total_distance_km = Number((picked.distanceM / 1000).toFixed(2));

      const seconds = picked.activeSec > 0 ? picked.activeSec : (picked.pointsDistance * 60);
      out.total_time = seconds > 0 ? secondsToHms(seconds) : null;
    }
  } catch {
    // ignore
  }

  try {
    const raw = await fs.readFile(intradayFile, 'utf8');
    const points = JSON.parse(raw);
    if (Array.isArray(points) && points.length > 0) {
      let sumStride = 0, countStride = 0, maxStride = 0;
      let sumHr = 0, countHr = 0, maxHr = 0;

      for (const p of points) {
        const stride = Number(p?.stride);
        if (Number.isFinite(stride) && stride > 0) {
          sumStride += stride;
          countStride++;
          if (stride > maxStride) maxStride = stride;
        }

        const hr = Number(p?.heartRate);
        if (Number.isFinite(hr) && hr > 0) {
          sumHr += hr;
          countHr++;
          if (hr > maxHr) maxHr = hr;
        }
      }

      out.avg_stride_cm = countStride > 0 ? Number((sumStride / countStride).toFixed(1)) : 0;
      out.max_stride_cm = maxStride > 0 ? Number(maxStride.toFixed(1)) : 0;
      out.avg_heart_rate = countHr > 0 ? Math.round(sumHr / countHr) : 0;
      out.max_heart_rate = maxHr > 0 ? Math.round(maxHr) : 0;

      if (!out.total_time) out.total_time = secondsToHms(points.length * 60);
    }
  } catch {
    // ignore
  }

  if (out.avg_speed <= 0 && out.total_distance_km > 0 && out.total_time) {
    const hours = parseHmsToSeconds(out.total_time) / 3600;
    if (hours > 0) out.avg_speed = Number((out.total_distance_km / hours).toFixed(1));
  }

  if (!Number.isFinite(out.calories_kcal)) out.calories_kcal = 0;
  out.calories_kcal = out.calories_kcal > 0 ? Number(out.calories_kcal.toFixed(0)) : 0;

  return out;
}

function hasScreenshotForRun(runId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT 1 AS ok FROM run_images WHERE run_id = ? LIMIT 1', [runId], (err, row) => {
      if (err) return reject(err);
      resolve(Boolean(row && row.ok));
    });
  });
}

function hasScreenshotMetricsForRun(runId) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT
        a.steps,
        a.total_distance,
        a.total_time,
        a.avg_speed,
        a.avg_heart_rate,
        a.calories,
        a.avg_stride
      FROM image_assets a
      JOIN run_images r ON a.asset_id = r.asset_id
      WHERE r.run_id = ?
      ORDER BY a.created_at DESC
      LIMIT 1
    `;
    db.get(sql, [runId], (err, row) => {
      if (err) return reject(err);
      if (!row) return resolve(false);
      const ok =
        row.steps !== null ||
        row.total_distance !== null ||
        row.total_time !== null ||
        row.avg_speed !== null ||
        row.avg_heart_rate !== null ||
        row.calories !== null ||
        row.avg_stride !== null;
      resolve(Boolean(ok));
    });
  });
}

function getAllRunDates() {
  return new Promise((resolve, reject) => {
    db.all('SELECT date FROM daily_summary ORDER BY date ASC', (err, rows) => {
      if (err) return reject(err);
      resolve((rows || []).map(r => r.date).filter(Boolean));
    });
  });
}

async function main() {
  const dates = await getAllRunDates();
  let updated = 0;
  let skipped = 0;

  for (const date of dates) {
    const cache = await computeDailySummaryFromCache(date);
    const hasShot = await hasScreenshotForRun(date);
    const hasShotMetrics = hasShot ? await hasScreenshotMetricsForRun(date) : false;

    // If screenshot exists, do NOT overwrite screenshot-priority fields.
    // Still update JSON-first max fields to align with 1-min values.
    const payload = (hasShot && hasShotMetrics)
      ? {
          date,
          max_speed: cache.max_speed,
          max_cadence: cache.max_cadence
        }
      : {
          date,
          step_count: cache.step_count,
          total_distance_km: cache.total_distance_km,
          total_time: cache.total_time,
          calories_kcal: cache.calories_kcal,
          avg_stride: cache.avg_stride_cm,
          max_stride: cache.max_stride_cm,
          hr_avg: cache.avg_heart_rate,
          hr_max: cache.max_heart_rate,
          avg_speed: cache.avg_speed,
          max_speed: cache.max_speed,
          avg_cadence: cache.avg_cadence,
          max_cadence: cache.max_cadence
        };

    const changed = await repo.saveDailySummary(payload);
    if (changed > 0) updated++;
    else skipped++;
  }

  console.log(`Done. updated=${updated} skipped=${skipped} rows=${dates.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

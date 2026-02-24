const path = require('path');
const fs = require('fs').promises;
const repo = require('./repo');
const db = require('./db');

function parseDateArg(raw) {
  const text = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  return text;
}

function secondsToHms(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function parseHmsToSeconds(hms) {
  if (!hms) return 0;
  const parts = String(hms).trim().split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return 0;
  if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.max(0, parts[0] * 60 + parts[1]);
  return 0;
}

async function computeDerivedFromCache(dateString) {
  const rawBucketsFile = path.join(__dirname, 'storage', 'cache', `raw_buckets_${dateString}.json`);
  const intradayFile = path.join(__dirname, 'storage', 'cache', `intraday_${dateString}.json`);

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
          countPitchAny += 1;

          if (bucketIsRun) {
            if (bucketSteps > maxPitchRun) maxPitchRun = bucketSteps;
            sumPitchRun += bucketSteps;
            countPitchRun += 1;
          }
        }

        if (bucketDistance > 0) {
          const speed = Number((bucketDistance * 0.06).toFixed(1));
          if (Number.isFinite(speed) && speed > 0) {
            if (speed > maxSpeedAny) maxSpeedAny = speed;
            sumSpeedAny += speed;
            countSpeedAny += 1;

            if (bucketIsRun) {
              if (speed > maxSpeedRun) maxSpeedRun = speed;
              sumSpeedRun += speed;
              countSpeedRun += 1;
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
    // ignore
  }

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
          countSpeed += 1;
        }

        const steps = Number(p?.steps);
        if (Number.isFinite(steps) && steps > 0) {
          if (steps > intradayMaxPitch) intradayMaxPitch = steps;
          sumPitch += steps;
          countPitch += 1;
        }
      }

      intradayAvgSpeed = countSpeed > 0 ? Number((sumSpeed / countSpeed).toFixed(1)) : 0;
      intradayAvgPitch = countPitch > 0 ? Math.round(sumPitch / countPitch) : 0;
    }
  } catch {
    // ignore
  }

  if (rawPoints === 0 && intradayPoints === 0) return null;

  // Align with app-side guards: treat very low cadence as noise and keep 0
  // so DB merge can use stronger existing values.
  if (rawAvgPitch > 0 && rawAvgPitch < 30) rawAvgPitch = 0;
  if (rawMaxPitch > 0 && rawMaxPitch < 30) rawMaxPitch = 0;
  if (intradayAvgPitch > 0 && intradayAvgPitch < 30) intradayAvgPitch = 0;
  if (intradayMaxPitch > 0 && intradayMaxPitch < 30) intradayMaxPitch = 0;

  return {
    avg_speed: intradayAvgSpeed > 0 ? intradayAvgSpeed : rawAvgSpeed,
    max_speed: rawMaxSpeed > 0 ? Number(rawMaxSpeed.toFixed(1)) : Number(intradayMaxSpeed.toFixed(1)),
    avg_cadence: rawAvgPitch > 0 ? rawAvgPitch : intradayAvgPitch,
    max_cadence: rawMaxPitch > 0 ? rawMaxPitch : intradayMaxPitch
  };
}

async function computeDailySummaryFromCache(dateString) {
  const rawBucketsFile = path.join(__dirname, 'storage', 'cache', `raw_buckets_${dateString}.json`);
  const intradayFile = path.join(__dirname, 'storage', 'cache', `intraday_${dateString}.json`);

  const out = {
    step_count: 0,
    total_distance_km: 0,
    total_time: null,
    calories_kcal: 0,
    avg_stride: 0,
    max_stride: 0,
    hr_avg: 0,
    hr_max: 0,
    avg_speed: 0,
    max_speed: 0,
    avg_cadence: 0,
    max_cadence: 0,
    has_running_activity: false
  };

  const derived = await computeDerivedFromCache(dateString);
  if (derived) {
    out.avg_speed = Number(derived.avg_speed || 0);
    out.max_speed = Number(derived.max_speed || 0);
    out.avg_cadence = Number(derived.avg_cadence || 0);
    out.max_cadence = Number(derived.max_cadence || 0);
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
              if (Number.isFinite(t) && t === 8) {
                bucketIsRun = true;
                out.has_running_activity = true;
              }
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
          }
        }

        if (bucketSteps > 0) any.steps += bucketSteps;
        if (bucketDistance > 0) {
          any.distanceM += bucketDistance;
          any.pointsDistance += 1;
        }
        if (bucketDistance > 0 || bucketSteps > 0) any.activeSec += 60;

        if (bucketIsRun) {
          if (bucketSteps > 0) run.steps += bucketSteps;
          if (bucketDistance > 0) {
            run.distanceM += bucketDistance;
            run.pointsDistance += 1;
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
      let sumStride = 0;
      let countStride = 0;
      let maxStride = 0;
      let sumHr = 0;
      let countHr = 0;
      let maxHr = 0;

      for (const p of points) {
        const stride = Number(p?.stride);
        if (Number.isFinite(stride) && stride > 0 && stride <= 250) {
          sumStride += stride;
          countStride += 1;
          if (stride > maxStride) maxStride = stride;
        }

        const hr = Number(p?.heartRate);
        if (Number.isFinite(hr) && hr > 0) {
          sumHr += hr;
          countHr += 1;
          if (hr > maxHr) maxHr = hr;
        }
      }

      out.avg_stride = countStride > 0 ? Number((sumStride / countStride).toFixed(1)) : 0;
      out.max_stride = maxStride > 0 ? Number(maxStride.toFixed(1)) : 0;
      out.hr_avg = countHr > 0 ? Math.round(sumHr / countHr) : 0;
      out.hr_max = maxHr > 0 ? Math.round(maxHr) : 0;

      if (!out.total_time) out.total_time = secondsToHms(points.length * 60);
    }
  } catch {
    // ignore
  }

  if (out.avg_speed <= 0 && out.total_distance_km > 0 && out.total_time) {
    const hours = parseHmsToSeconds(out.total_time) / 3600;
    if (hours > 0) out.avg_speed = Number((out.total_distance_km / hours).toFixed(1));
  }

  out.calories_kcal = Number.isFinite(out.calories_kcal) && out.calories_kcal > 0
    ? Number(out.calories_kcal.toFixed(0))
    : 0;

  return out;
}

async function listTargetDates(fromDate) {
  const cacheDir = path.join(__dirname, 'storage', 'cache');
  const files = await fs.readdir(cacheDir);
  const set = new Set();

  for (const name of files) {
    let m = name.match(/^raw_buckets_(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) m = name.match(/^intraday_(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const d = m[1];
    if (d >= fromDate) set.add(d);
  }

  return Array.from(set).sort();
}

async function main() {
  const fromArg = parseDateArg(process.argv[2]) || '2025-11-01';
  const reset = !process.argv.includes('--no-reset');
  const debugDates = new Set(
    String(process.env.DEBUG_DATES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const dates = await listTargetDates(fromArg);

  if (dates.length === 0) {
    console.log(`No cache dates found from ${fromArg}`);
    return;
  }

  if (reset) {
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM daily_summary WHERE date >= ?', [fromArg], (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let excludedNotRunning = 0;

  for (const date of dates) {
    try {
      const payload = await computeDailySummaryFromCache(date);
      if (debugDates.has(date)) {
        console.log(`[DEBUG] ${date} max_stride=${payload.max_stride} avg_stride=${payload.avg_stride} hr_avg=${payload.hr_avg}`);
      }
      if (!payload.has_running_activity) {
        excludedNotRunning += 1;
        continue;
      }
      await repo.saveDailySummary({
        date,
        step_count: payload.step_count,
        total_distance_km: payload.total_distance_km,
        total_time: payload.total_time,
        calories_kcal: payload.calories_kcal,
        max_stride: payload.max_stride,
        avg_stride: payload.avg_stride,
        hr_avg: payload.hr_avg,
        hr_max: payload.hr_max,
        avg_speed: payload.avg_speed,
        max_speed: payload.max_speed,
        avg_cadence: payload.avg_cadence,
        max_cadence: payload.max_cadence,
        message: null
      });
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`[FAILED] ${date}: ${err && err.message ? err.message : err}`);
    }
  }

  skipped = dates.length - updated - failed;
  console.log(`from=${fromArg}`);
  console.log(`reset=${reset}`);
  console.log(`dates=${dates.length}`);
  console.log(`updated=${updated}`);
  console.log(`excluded_not_running=${excludedNotRunning}`);
  console.log(`failed=${failed}`);
  console.log(`skipped=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

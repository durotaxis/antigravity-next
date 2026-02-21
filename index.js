require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const repo = require('./repo');
const imageRepo = require('./image_repo');
const imageService = require('./image_service');
const ocrComponent = require('./ocr_component');
const fs = require('fs').promises;
const geminiService = require('./gemini_service');
const openaiService = require('./openai_service');
const googleFitService = require('./google_fit_service');

const app = express();
const port = 3000;
const GEMINI_RATE_LIMIT_MESSAGE = "利用回数が制限を超えました。お手数ですが、回復する（16時）までお待ち下さい。";

async function computeDerivedFromIntradayCache(dateString) {
  try {
    // Prefer RAW buckets for 1-minute max values.
    // Prefer processed intraday for averages (it includes filtering).
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

    // Guard against sparse/raw-delayed buckets that can produce false low cadence (e.g. 2-6 spm).
    // Keep 0 so downstream merge logic can fall back to existing DB values instead of overwriting with noise.
    if (rawAvgPitch > 0 && rawAvgPitch < 30) rawAvgPitch = 0;
    if (rawMaxPitch > 0 && rawMaxPitch < 30) rawMaxPitch = 0;
    if (intradayAvgPitch > 0 && intradayAvgPitch < 30) intradayAvgPitch = 0;
    if (intradayMaxPitch > 0 && intradayMaxPitch < 30) intradayMaxPitch = 0;

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

function mergePositiveAverage(current, existing, decimals = 1) {
  const a = Number(current);
  const b = Number(existing);
  const hasA = Number.isFinite(a) && a > 0;
  const hasB = Number.isFinite(b) && b > 0;
  if (hasA && hasB) return Number((((a + b) / 2)).toFixed(decimals));
  if (hasA) return Number(a.toFixed(decimals));
  if (hasB) return Number(b.toFixed(decimals));
  return 0;
}

function mergePositiveMax(current, existing, decimals = 1) {
  const a = Number(current);
  const b = Number(existing);
  const max = Math.max(
    Number.isFinite(a) && a > 0 ? a : 0,
    Number.isFinite(b) && b > 0 ? b : 0
  );
  if (max <= 0) return 0;
  return Number(max.toFixed(decimals));
}

function mergePositiveSum(current, existing, decimals = 2) {
  const a = Number(current);
  const b = Number(existing);
  const sum =
    (Number.isFinite(a) && a > 0 ? a : 0) +
    (Number.isFinite(b) && b > 0 ? b : 0);
  if (sum <= 0) return 0;
  return Number(sum.toFixed(decimals));
}

function mergeTimeSum(currentHms, existingHms) {
  const secA = parseHmsToSeconds(currentHms);
  const secB = parseHmsToSeconds(existingHms);
  const sum = Math.max(0, secA) + Math.max(0, secB);
  return sum > 0 ? secondsToHms(sum) : null;
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return defaultValue;
}

function resolveBatchRunDate(batchItem) {
  // Run date rule:
  // OCR extracted date first, then selected run date (input.date/runId) as fallback.
  const dataDate = batchItem && batchItem.data && batchItem.data.date ? String(batchItem.data.date).trim() : '';
  if (dataDate) return dataDate;

  const inputDate = batchItem && batchItem.input && batchItem.input.date ? String(batchItem.input.date).trim() : '';
  if (inputDate) return inputDate;

  const runId = batchItem && batchItem.input && batchItem.input.runId ? String(batchItem.input.runId).trim() : '';
  return runId || '';
}

async function persistBatchItem(batchItem) {
  const runDate = resolveBatchRunDate(batchItem);
  if (!runDate) {
    return { ok: false, reason: 'MISSING_RUN_DATE' };
  }

  const existingSummary = await repo.getDailySummary(runDate);
  const data = (batchItem && batchItem.data && typeof batchItem.data === 'object') ? batchItem.data : {};
  const currentStepCount = Number(data.step_count || 0);
  const currentTotalDistanceKm = Number(data.total_distance_km || 0);
  const currentTotalTime = data.total_time || null;
  const currentCaloriesKcal = Number(data.calories_kcal || 0);
  const currentMaxStride = Number(data.max_stride_cm || 0);
  const currentAvgStride = Number(data.avg_stride_cm || 0);
  const currentHrMax = Number(data.max_heart_rate || 0);
  const currentHrAvg = Number(data.avg_heart_rate || 0);
  const currentAvgCadence = Number(data.avg_cadence || 0);
  const currentMaxCadence = Number(data.max_cadence || 0);
  const currentAvgSpeed = Number(data.avg_speed || 0);
  const currentMaxSpeed = Number(data.max_speed || 0);

  const summary = {
    date: runDate,
    step_count: Math.round(mergePositiveSum(currentStepCount, existingSummary && existingSummary.step_count, 0)),
    total_distance_km: mergePositiveSum(currentTotalDistanceKm, existingSummary && existingSummary.total_distance_km, 2),
    total_time: mergeTimeSum(currentTotalTime, existingSummary && existingSummary.total_time),
    calories_kcal: Math.round(mergePositiveSum(currentCaloriesKcal, existingSummary && existingSummary.calories_kcal, 0)),
    max_stride: mergePositiveMax(currentMaxStride, existingSummary && existingSummary.max_stride, 1),
    avg_stride: mergePositiveAverage(currentAvgStride, existingSummary && existingSummary.avg_stride, 1),
    hr_max: mergePositiveMax(currentHrMax, existingSummary && existingSummary.hr_max, 0),
    hr_avg: mergePositiveAverage(currentHrAvg, existingSummary && existingSummary.hr_avg, 0),
    avg_cadence: mergePositiveAverage(currentAvgCadence, existingSummary && existingSummary.avg_cadence, 0),
    max_cadence: mergePositiveMax(currentMaxCadence, existingSummary && existingSummary.max_cadence, 0),
    avg_speed: mergePositiveAverage(currentAvgSpeed, existingSummary && existingSummary.avg_speed, 1),
    max_speed: mergePositiveMax(currentMaxSpeed, existingSummary && existingSummary.max_speed, 1),
    message: null
  };

  await repo.saveDailySummary(summary);

  const storedFilename = batchItem && batchItem.input && batchItem.input.filename
    ? String(batchItem.input.filename).trim()
    : '';
  const inputRunId = batchItem && batchItem.input && batchItem.input.runId
    ? String(batchItem.input.runId).trim()
    : '';
  const inputDate = batchItem && batchItem.input && batchItem.input.date
    ? String(batchItem.input.date).trim()
    : '';

  if (!storedFilename) {
    return { ok: true, persisted_date: runDate, linked_asset: false };
  }

  const asset = await imageRepo.findAssetByStoredFilename(storedFilename);
  if (!asset || !asset.asset_id) {
    return { ok: true, persisted_date: runDate, linked_asset: false, reason: 'ASSET_NOT_FOUND' };
  }

  await imageRepo.updateAssetMetricsById(asset.asset_id, {
    step_count: summary.step_count,
    total_distance_km: summary.total_distance_km,
    total_time: summary.total_time,
    avg_speed: summary.avg_speed,
    avg_heart_rate: summary.hr_avg,
    calories_kcal: summary.calories_kcal,
    avg_stride_cm: summary.avg_stride
  });
  await imageRepo.linkImageToRun(runDate, asset.asset_id);

  // If the OCR-derived run date differs from input linkage, detach the old linkage.
  if (inputRunId && inputRunId !== runDate) {
    await imageRepo.unlinkImageFromRun(inputRunId, asset.asset_id).catch(() => { });
  }
  if (inputDate && inputDate !== runDate && inputDate !== inputRunId) {
    await imageRepo.unlinkImageFromRun(inputDate, asset.asset_id).catch(() => { });
  }

  return { ok: true, persisted_date: runDate, linked_asset: true, asset_id: asset.asset_id };
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
        // Match google_fit_service cleaning: drop physiologically unlikely stride spikes.
        if (Number.isFinite(stride) && stride > 0 && stride <= 250) {
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

// --- Security & Config ---
// 蜈ｨ繧ｪ繝ｪ繧ｸ繝ｳ險ｱ蜿ｯ (繧ｹ繝槭・縺九ｉ縺ｮ謗･邯壹ｒ繧ｹ繝繝ｼ繧ｺ縺ｫ)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const genAI = null; // Removed generic init
const model = null; // Removed generic init

// --- API Controller ---

// 1. Get All Runs (繧ｷ繝ｳ繝励Ν繝ｻ繧､繧ｺ繝ｻ繝吶せ繝・
// DB縺ｫ縺ゅｋ莠句ｮ滂ｼ域律莉倥√せ繝医Λ繧､繝峨∝ｿ・牛謨ｰ縲∫判蜒擾ｼ峨□縺代ｒ霑斐＠縺ｾ縺・
app.get('/api/runs', async (req, res) => {
  try {
    const rawRuns = await repo.getAllRuns();
    const imageBaseUrl = process.env.PUBLIC_API_ORIGIN || `${req.protocol}://${req.get('host')}`;

    const includeDerived = String(req.query.includeDerived || '') === '1';

    const formattedRuns = await Promise.all(rawRuns.map(async (row) => {
      const derived = includeDerived ? await computeDerivedFromIntradayCache(row.date) : null;
      const images = Array.isArray(row.images)
        ? row.images.map((img) => {
            const rawUrl = String(img?.url || '').trim();
            if (!rawUrl) return img;
            if (/^https?:\/\//i.test(rawUrl)) return img;
            const normalized = rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
            return { ...img, url: `${imageBaseUrl}${normalized}` };
          })
        : [];

      return ({
      id: row.id,
      date: row.date,
      // Next迚医′蠢・ｦ√→縺吶ｋ繝・・繧ｿ縺ｮ縺ｿ
      step_count: row.step_count ?? 0,
      total_distance_km: row.total_distance_km ?? 0,
      total_time: row.total_time ?? null,
      calories_kcal: row.calories_kcal ?? 0,
      avg_stride: row.avg_stride ?? 0,
      avg_heart_rate: row.hr_avg ?? 0,
      max_stride: row.max_stride ?? 0,
      max_heart_rate: row.hr_max ?? 0,
      avg_cadence: row.avg_cadence ?? 0,
      max_cadence: row.max_cadence ?? 0,
      avg_speed: row.avg_speed ?? 0,
      max_speed: row.max_speed ?? 0,
      ...(derived || {}),
      images,
      message: row.message || '' // AI繧｢繝峨ヰ繧､繧ｹ
      });
    }));

    res.json(formattedRuns);
  } catch (err) {
    console.error("Repo Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Delete Run
app.delete('/api/runs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const changes = await repo.deleteRun(id);
    if (changes === 0) return res.status(404).json({ error: 'Run not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2.5 Get Single Daily Title/Message
app.get('/api/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const summary = await repo.getDailySummary(date);
    if (!summary) return res.status(404).json({ error: 'No summary found' });
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }

});

// 2.6 Get Intraday Stride Data (For Chart)
app.get('/api/stride', async (req, res) => {
  try {
    const { date } = req.query;
    const syncSummary = String(req.query.sync || '') === '1';
    if (!date) return res.status(400).json({ error: 'Date required' });

    // Always go through googleFitService first.
    // If it yields empty, fall back to processed cache for operational resilience.
    let chartData = await googleFitService.getIntradayMetrics(date);
    if (!Array.isArray(chartData) || chartData.length === 0) {
      try {
        const cacheFile = path.join(__dirname, 'storage', 'cache', `intraday_${date}.json`);
        const raw = await fs.readFile(cacheFile, 'utf8');
        const cached = JSON.parse(raw);
        if (Array.isArray(cached) && cached.length > 0) {
          chartData = cached;
        }
      } catch {
        // keep empty
      }
    }

    // Optional sync for legacy RUN ANALYZER: fill missing daily_summary fields from intraday.
    if (syncSummary && Array.isArray(chartData) && chartData.length > 0) {
      let sumStride = 0, countStride = 0, maxStride = 0;
      let sumHr = 0, countHr = 0, maxHr = 0;
      let sumCad = 0, countCad = 0, maxCad = 0;
      let sumSpeed = 0, countSpeed = 0, maxSpeed = 0;

      for (const p of chartData) {
        const stride = Number(p?.stride);
        if (Number.isFinite(stride) && stride > 0 && stride <= 300) {
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

        const cad = Number(p?.steps);
        if (Number.isFinite(cad) && cad > 0) {
          sumCad += cad;
          countCad++;
          if (cad > maxCad) maxCad = cad;
        }

        const speed = Number(p?.speed);
        if (Number.isFinite(speed) && speed > 0) {
          sumSpeed += speed;
          countSpeed++;
          if (speed > maxSpeed) maxSpeed = speed;
        }
      }

      const existing = await repo.getDailySummary(String(date));
      // Do not create a new daily_summary row from RUN ANALYZER sync.
      // Sync is only for filling missing fields on already-existing rows.
      if (!existing) {
        return res.json(chartData);
      }
      const nextAvgStride = countStride > 0 ? Number((sumStride / countStride).toFixed(1)) : null;
      const nextMaxStride = maxStride > 0 ? Number(maxStride.toFixed(1)) : null;
      const nextAvgHr = countHr > 0 ? Math.round(sumHr / countHr) : null;
      const nextMaxHr = maxHr > 0 ? Math.round(maxHr) : null;
      const nextAvgCad = countCad > 0 ? Math.round(sumCad / countCad) : null;
      const nextMaxCad = maxCad > 0 ? maxCad : null;
      const nextAvgSpeed = countSpeed > 0 ? Number((sumSpeed / countSpeed).toFixed(2)) : null;
      const nextMaxSpeed = maxSpeed > 0 ? Number(maxSpeed.toFixed(1)) : null;

      // Fill only missing fields; do not override existing daily_summary values here.
      await repo.saveDailySummary({
        date: String(date),
        avg_stride: (!existing || !(Number(existing.avg_stride) > 0)) ? nextAvgStride : null,
        max_stride: (!existing || !(Number(existing.max_stride) > 0)) ? nextMaxStride : null,
        hr_avg: (!existing || !(Number(existing.hr_avg) > 0)) ? nextAvgHr : null,
        hr_max: (!existing || !(Number(existing.hr_max) > 0)) ? nextMaxHr : null,
        avg_cadence: (!existing || !(Number(existing.avg_cadence) > 0)) ? nextAvgCad : null,
        max_cadence: (!existing || !(Number(existing.max_cadence) > 0)) ? nextMaxCad : null,
        avg_speed: (!existing || !(Number(existing.avg_speed) > 0)) ? nextAvgSpeed : null,
        max_speed: (!existing || !(Number(existing.max_speed) > 0)) ? nextMaxSpeed : null
      });
    }

    res.json(chartData);
  } catch (err) {
    console.error("Stride API Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Update Daily Summary (謇句虚菫ｮ豁｣縺ｪ縺ｩ)
app.post('/api/daily', async (req, res) => {
  try {
    const { date, max_stride, avg_stride, hr_max, hr_avg, message } = req.body;

    if (!date) return res.status(400).json({ error: 'Date is required' });

    // 繧ｭ繝｣繝｡繝ｫ繧ｱ繝ｼ繧ｹ/繧ｹ繝阪・繧ｯ繧ｱ繝ｼ繧ｹ縺ｮ謠ｺ繧後ｒ蜷ｸ蜿・
    const data = {
      date,
      max_stride: max_stride ?? req.body.maxStride,
      avg_stride: avg_stride ?? req.body.avgStride,
      hr_max: hr_max ?? req.body.maxHR,
      hr_avg: hr_avg ?? req.body.avgHR,
      message: message ?? ''
    };
    await repo.saveDailySummary(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- File & Image Management (Inbox讖溯・) ---

app.get('/api/inbox/files', async (req, res) => {
  try {
    const files = await imageService.getInboxFiles();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/inbox/preview/:filename', (req, res) => {
  const { filename } = req.params;
  if (filename.includes('..') || filename.includes('/')) return res.status(400).send('Invalid');
  const filepath = path.join(imageService.INBOX_DIR, filename);
  res.sendFile(filepath);
});

app.post('/api/runs/:runId/import-selected', async (req, res) => {
  try {
    const { runId } = req.params;
    const { filenames } = req.body;
    if (!Array.isArray(filenames)) return res.status(400).json({ error: 'Invalid input' });
    const skipAdvice = toBool(req.body && req.body.skipAdvice, false);
    const skipSummary = toBool(req.body && req.body.skipSummary, false);
    const results = await imageService.importSelectedFiles(filenames, runId, { skipAdvice, skipSummary });
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/runs/:runId/images', async (req, res) => {
  try {
    const { runId } = req.params;
    const images = await imageRepo.getImagesForRun(runId);
    res.json(images || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/images/candidates', async (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    if (!date) return res.status(400).json({ error: 'date is required' });

    const candidates = await imageRepo.getBatchCandidatesForDate(date);
    res.json(candidates || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 2.7 Delete Image Asset (Disabled)
app.delete('/api/runs/:runId/images/:assetId', async (req, res) => {
  return res.status(410).json({
    error: 'Image delete is disabled to protect summary consistency.',
    code: 'IMAGE_DELETE_DISABLED'
  });
});

// --- Upload & Analysis (Core Feature) ---

const multer = require('multer');
const crypto = require('crypto');
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'public/assets/store/') },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const hash = crypto.createHash('sha256').update(file.originalname + Date.now()).digest('hex').substring(0, 12);
    cb(null, `upload_${hash}${ext}`);
  }
});
const upload = multer({ storage: storage });

// 逕ｻ蜒上い繝・・繝ｭ繝ｼ繝・-> Gemini隗｣譫・-> DB菫晏ｭ・
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const filename = req.file.filename;
    const originalName = req.file.originalname;
    

    // 1. Asset菴懈・ (Hash & Deduplication)
    const fs = require('fs').promises;
    const fileBuffer = await fs.readFile(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const forcedRunId = (req.body && (req.body.runId || req.body.date))
      ? String(req.body.runId || req.body.date).trim()
      : '';
    const allowInputDateFallback = toBool(req.body && req.body.useInputDateFallback, true);
    const skipAdvice = toBool(req.body && req.body.skipAdvice, toBool(process.env.SKIP_ADVICE_GENERATION, false));

    const existingAsset = await imageRepo.findAssetByHash(fileHash);
    if (existingAsset) {
      // Multer already stored the file with a random filename; remove it for duplicate uploads.
      await fs.unlink(req.file.path).catch(() => { });

      // Without run date, duplicate reuse cannot be shown anywhere in UI.
      if (!allowInputDateFallback || !forcedRunId) {
        return res.status(422).json({
          error: 'Could not determine run date from image. Duplicate image was not linked.',
          code: 'MISSING_RUN_DATE'
        });
      }

      await repo.saveDailySummary({
        date: forcedRunId,
        message: null
      });
      await imageRepo.linkImageToRun(forcedRunId, existingAsset.asset_id);

      return res.json({
        success: true,
        data: {
          duplicate_upload: true,
          linked_run_id: forcedRunId || null,
          asset_id: existingAsset.asset_id,
          stored_filename: existingAsset.stored_filename || null,
          original_filename: existingAsset.original_filename || originalName
        }
      });
    }

    const assetId = await imageRepo.createAsset(fileHash, filename, originalName);

    // 3. Main Analysis (Gemini)
    // If OCR fails, we still ingest the image and create/link the asset without crashing the request.
    
    let result = {};
    let ocrFailed = false;
    try {
      const analyzed = await ocrComponent.analyzeScreenOcr(filename);
      result = analyzed && typeof analyzed === 'object' ? analyzed : {};
      
    } catch (ocrErr) {
      ocrFailed = true;
      console.error("OCR Failed (continuing import):", ocrErr && ocrErr.message ? ocrErr.message : ocrErr);
      result = {
        ocr_failed: true,
        ocr_error: ocrErr && ocrErr.message ? String(ocrErr.message) : 'OCR failed'
      };
    }

    if (ocrFailed) {
      // Do not keep image-only records without a run date.
      if (!allowInputDateFallback || !forcedRunId) {
        await imageRepo.deleteAssetWithFile(assetId).catch(() => { });
        return res.status(422).json({
          error: 'Could not determine run date from image. Image import was rolled back.',
          code: 'MISSING_RUN_DATE'
        });
      }

      // Ensure the run exists even when OCR fails and date is forced by caller.
      await repo.saveDailySummary({
        date: forcedRunId,
        message: null
      });

      result.date = forcedRunId;
      await imageRepo.updateAssetMetricsById(assetId, result);

      try {
        await imageRepo.linkImageToRun(forcedRunId, assetId);
      } catch (linkErr) {
        console.error("Link Failed (ignored):", linkErr && linkErr.message ? linkErr.message : linkErr);
      }

      return res.json({
        success: true,
        data: {
          ...result,
          asset_id: assetId,
          stored_filename: filename,
          original_filename: originalName
        }
      });
    }

    // If OCR did not produce date, fallback to caller-provided runId/date.
    if (!result.date && allowInputDateFallback && forcedRunId) {
      result.date = forcedRunId;
    }

    // Prevent image-only registration without a matching daily summary key.
    if (!result.date) {
      await imageRepo.deleteAssetWithFile(assetId).catch(() => { });
      return res.status(422).json({
        error: 'Could not determine run date from image. Image import was rolled back.',
        code: 'MISSING_RUN_DATE'
      });
    }

    // Persist avg_speed into image_assets.
    const parsedAvgSpeed = Number.parseFloat(result?.avg_speed);
    let computedAvgSpeed = Number.isFinite(parsedAvgSpeed) ? parsedAvgSpeed : 0;
    if (computedAvgSpeed <= 0 && result?.total_distance_km > 0 && result?.total_time) {
      const parts = String(result.total_time).split(':').map(Number);
      let hours = 0;
      if (parts.length === 3) hours = parts[0] + parts[1] / 60 + parts[2] / 3600;
      else if (parts.length === 2) hours = parts[0] / 60 + parts[1] / 3600;
      if (hours > 0) computedAvgSpeed = parseFloat((result.total_distance_km / hours).toFixed(1));
    }
    result.avg_speed = computedAvgSpeed;

    // 2. 譌･莉倥′蜿悶ｌ縺溘ｉGoogle Fit縺九ｉ豁｣遒ｺ縺ｪ繝・・繧ｿ繧貞叙蠕励＠縺ｦDB縺ｫ菫晏ｭ・
    if (result.date) {

      // 笘・Optimization: Check if summary already exists before calling Fit API
      const existingSummary = await repo.getDailySummary(result.date);
      const cacheMetrics = await computeDailySummaryFromCache(result.date);

      const summaryStepCount = pickPositive(result.step_count, cacheMetrics.step_count);
      const summaryTotalDistanceKm = pickPositive(result.total_distance_km, cacheMetrics.total_distance_km);
      const summaryTotalTime = pickText(result.total_time, cacheMetrics.total_time);
      const summaryCaloriesKcal = pickPositive(result.calories_kcal, cacheMetrics.calories_kcal);

      let fitMetrics = {
        avg_stride_cm: cacheMetrics.avg_stride_cm || 0,
        max_stride_cm: cacheMetrics.max_stride_cm || 0,
        avg_heart_rate: cacheMetrics.avg_heart_rate || 0,
        max_heart_rate: cacheMetrics.max_heart_rate || 0,
        avg_cadence: cacheMetrics.avg_cadence || 0,
        max_cadence: cacheMetrics.max_cadence || 0,
        max_speed: cacheMetrics.max_speed || 0
      };

      // --- REFRESH METRICS FROM GOOGLE FIT ---
      // We always attempt to fetch fresh metrics during analysis to ensure the Dashboard (DB)
      // matches the latest filtering/smoothing logic in google_fit_service.
      try {
        
        const fitData = null; // prefer local JSON cache to avoid API requests
        if (fitData) {
          
          fitMetrics = fitData;
        }
      } catch (fitErr) {
        console.error("Google Fit Refresh Failed (falling back to stored/vision data):", fitErr.message);
        // Fallback to existing summary if available
        if (existingSummary) {
          fitMetrics = {
            avg_heart_rate: existingSummary.hr_avg,
            max_heart_rate: existingSummary.hr_max,
            avg_stride_cm: existingSummary.avg_stride,
            max_stride_cm: existingSummary.max_stride,
            avg_cadence: existingSummary.avg_cadence,
            max_cadence: existingSummary.max_cadence,
            max_speed: existingSummary.max_speed
          };
        }
      }

      let safeMaxStride = (result.max_stride_cm > 0) ? result.max_stride_cm
        : (fitMetrics.max_stride_cm > 0) ? fitMetrics.max_stride_cm
          : (existingSummary && existingSummary.max_stride > 0) ? existingSummary.max_stride : 0;

      const safeAvgStride = (result.avg_stride_cm > 0) ? result.avg_stride_cm
        : (fitMetrics.avg_stride_cm > 0) ? fitMetrics.avg_stride_cm
          : (existingSummary && existingSummary.avg_stride > 0) ? existingSummary.avg_stride : 0;

      const safeMaxHR = (result.max_heart_rate > 0) ? result.max_heart_rate
        : (fitMetrics.max_heart_rate > 0) ? fitMetrics.max_heart_rate
          : (existingSummary && existingSummary.hr_max > 0) ? existingSummary.hr_max : 0;

      const safeAvgHR = (result.avg_heart_rate > 0) ? result.avg_heart_rate
        : (fitMetrics.avg_heart_rate > 0) ? fitMetrics.avg_heart_rate
          : (existingSummary && existingSummary.hr_avg > 0) ? existingSummary.hr_avg : 0;

      // --- CADENCE / PITCH ---
      // Keep original intent (daily_summary-first) while filling missing values from
      // OCR/cache/calculation in a deterministic order.
      const cadenceFromSummary = (() => {
        const sec = parseHmsToSeconds(summaryTotalTime);
        if (!(summaryStepCount > 0) || !(sec > 0)) return 0;
        return Math.round(summaryStepCount / (sec / 60));
      })();

      let finalAvgCadence = pickPositive(
        result.avg_cadence,
        pickPositive(
          cacheMetrics.avg_cadence,
          pickPositive(
            fitMetrics.avg_cadence,
            pickPositive(cadenceFromSummary, existingSummary && existingSummary.avg_cadence)
          )
        )
      );

      let finalMaxCadence = pickPositive(
        fitMetrics.max_cadence,
        pickPositive(
          cacheMetrics.max_cadence,
          pickPositive(result.max_cadence, existingSummary && existingSummary.max_cadence)
        )
      );
      if (finalMaxCadence <= 0 && finalAvgCadence > 0) finalMaxCadence = finalAvgCadence;
      if (finalMaxCadence > 0 && finalAvgCadence > 0 && finalMaxCadence < finalAvgCadence) finalMaxCadence = finalAvgCadence;

      // --- SPEED CALCULATION (User Request) ---
      // Avg Speed: Priority JSON(cache) > Vision > Calculated
      const derivedSpeed = await computeDerivedFromIntradayCache(result.date);
      let finalAvgSpeed = (result.avg_speed > 0) ? result.avg_speed : ((derivedSpeed && derivedSpeed.json_avg_speed > 0) ? derivedSpeed.json_avg_speed : 0);
      if (finalAvgSpeed === 0 && result.total_distance_km > 0 && result.total_time) {
        // Calculate from Vision data if missing
        const parts = result.total_time.split(':').map(Number);
        let hours = 0;
        if (parts.length === 3) hours = parts[0] + parts[1] / 60 + parts[2] / 3600;
        else if (parts.length === 2) hours = parts[0] / 60 + parts[1] / 3600;

        if (hours > 0) finalAvgSpeed = parseFloat((result.total_distance_km / hours).toFixed(1));
      }

      // Max Speed: Priority Fit (1-min max) > Vision
      const finalMaxSpeed = (fitMetrics.max_speed > 0) ? fitMetrics.max_speed : (result.max_speed || 0);

      // Persist computed speeds into asset metrics (image_assets) as well.
      result.avg_speed = finalAvgSpeed;
      result.max_speed = finalMaxSpeed;

      // Merge when the same run date already has OCR-derived values from another screenshot.
      // max*: keep the strongest value, avg*: average current and existing to avoid last-write-wins drift.
      const mergedMaxStride = mergePositiveMax(safeMaxStride, existingSummary && existingSummary.max_stride, 1);
      const mergedAvgStride = mergePositiveAverage(safeAvgStride, existingSummary && existingSummary.avg_stride, 1);
      const mergedMaxHR = mergePositiveMax(safeMaxHR, existingSummary && existingSummary.hr_max, 0);
      const mergedAvgHR = mergePositiveAverage(safeAvgHR, existingSummary && existingSummary.hr_avg, 0);
      const mergedMaxCadence = mergePositiveMax(finalMaxCadence, existingSummary && existingSummary.max_cadence, 0);
      const mergedAvgCadence = mergePositiveAverage(finalAvgCadence, existingSummary && existingSummary.avg_cadence, 0);
      const mergedMaxSpeed = mergePositiveMax(finalMaxSpeed, existingSummary && existingSummary.max_speed, 1);
      const mergedAvgSpeed = mergePositiveAverage(finalAvgSpeed, existingSummary && existingSummary.avg_speed, 1);
      const mergedStepCount = Math.round(mergePositiveSum(summaryStepCount, existingSummary && existingSummary.step_count, 0));
      const mergedTotalDistanceKm = mergePositiveSum(summaryTotalDistanceKm, existingSummary && existingSummary.total_distance_km, 2);
      const mergedTotalTime = mergeTimeSum(summaryTotalTime, existingSummary && existingSummary.total_time);

      await repo.saveDailySummary({
        date: result.date,
        step_count: mergedStepCount,
        total_distance_km: mergedTotalDistanceKm,
        total_time: mergedTotalTime,
        calories_kcal: summaryCaloriesKcal,
        max_stride: mergedMaxStride,
        avg_stride: mergedAvgStride,
        hr_max: mergedMaxHR,
        hr_avg: mergedAvgHR,
        avg_cadence: mergedAvgCadence,
        max_cadence: mergedMaxCadence,
        avg_speed: mergedAvgSpeed,
        max_speed: mergedMaxSpeed,
        message: (existingSummary ? existingSummary.message : '') // Preserve existing message too
      });

      // 笘・Generate Advice (Async update)
      if (!skipAdvice) {
        try {
        

        // 笘・FIX: Pass Safe Metrics (from Google Fit) to AI, NOT raw OCR result which might be 0
        const advice = await geminiService.generateAdvice({
          date: result.date,
          step_count: mergedStepCount,
          total_distance_km: mergedTotalDistanceKm,
          calories_kcal: summaryCaloriesKcal,
          avg_stride_cm: mergedAvgStride,
          max_stride_cm: mergedMaxStride,
          avg_heart_rate: mergedAvgHR,
          max_heart_rate: mergedMaxHR,
          avg_cadence: mergedAvgCadence,
          max_cadence: mergedMaxCadence,
          avg_speed: mergedAvgSpeed,
          max_speed: mergedMaxSpeed
        }, [req.file.path]);

        const adviceToSave = (advice === GEMINI_RATE_LIMIT_MESSAGE &&
          existingSummary &&
          String(existingSummary.message || '').trim().length > 0 &&
          String(existingSummary.message || '').trim() !== GEMINI_RATE_LIMIT_MESSAGE)
          ? existingSummary.message
          : advice;

        await repo.saveDailySummary({
          date: result.date,
          step_count: mergedStepCount,
          total_distance_km: mergedTotalDistanceKm,
          total_time: mergedTotalTime,
          calories_kcal: summaryCaloriesKcal,
          max_stride: mergedMaxStride,
          avg_stride: mergedAvgStride,
          hr_max: mergedMaxHR,
          hr_avg: mergedAvgHR,
          avg_cadence: mergedAvgCadence,
          max_cadence: mergedMaxCadence,
          avg_speed: mergedAvgSpeed,
          max_speed: mergedMaxSpeed,
          message: adviceToSave // Update with advice
        });
        
        } catch (adviceErr) {
          console.error("Advice Gen Failed:", adviceErr.message);
        }
      }

      // 逕ｻ蜒上ｒRun縺ｫ邏蝉ｻ倥￠
      await imageRepo.linkImageToRun(result.date, assetId);
    }

    // 3. 繧｢繧ｻ繝・ヨ諠・ｱ譖ｴ譁ｰ
    await imageRepo.updateAssetMetricsById(assetId, result);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Batch OCR (componentized entry point)
app.post('/api/analyze/batch', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    const persist = toBool(payload.persist, false);
    if (items.length === 0) {
      return res.status(400).json({ error: 'items is required (array)' });
    }

    const batchResult = await ocrComponent.analyzeBatchJob(payload);
    let persisted = null;

    if (persist) {
      const persistResults = [];
      for (const row of batchResult.results || []) {
        if (!row || !row.ok) {
          persistResults.push({
            item_id: row && (row.item_id || null),
            ok: false,
            reason: 'OCR_FAILED'
          });
          continue;
        }
        if (row.mode !== 'vision') {
          persistResults.push({
            item_id: row.item_id || null,
            ok: false,
            reason: 'MOCK_NOT_ALLOWED',
            mode: row.mode
          });
          continue;
        }
        try {
          const one = await persistBatchItem(row);
          persistResults.push({
            item_id: row.item_id || null,
            ...one
          });
        } catch (persistErr) {
          persistResults.push({
            item_id: row.item_id || null,
            ok: false,
            reason: persistErr && persistErr.message ? String(persistErr.message) : 'PERSIST_FAILED'
          });
        }
      }

      const persistSuccess = persistResults.filter(r => r.ok).length;
      persisted = {
        requested: true,
        total: persistResults.length,
        success: persistSuccess,
        failed: persistResults.length - persistSuccess,
        results: persistResults
      };
    }

    return res.json({
      success: true,
      mode: 'batch',
      ...batchResult,
      persisted
    });
  } catch (err) {
    console.error("Batch OCR Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Batch OCR Mock (legacy endpoint)
app.post('/api/analyze/batch/mock', async (req, res) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};
    const items = Array.isArray(payload.items) ? payload.items : [];
    if (items.length === 0) {
      return res.status(400).json({ error: 'items is required (array)' });
    }
    const batchResult = await ocrComponent.analyzeBatchMock(items);
    return res.json({
      success: true,
      mode: 'batch-mock',
      ...batchResult
    });
  } catch (err) {
    console.error("Batch Mock Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Advice API (OpenAI)
app.post('/api/advice', async (req, res) => {
  try {
    const { date, stepCount, totalDistanceKm, totalTime, avgStride, maxStride, avgHR, maxHR, avgCadence, maxCadence, avgSpeed, maxSpeed } = req.body;

    const cached = await repo.getDailySummary(date);
    const cacheMetrics = await computeDailySummaryFromCache(date);
    if (cached && cached.message) {
      await repo.saveDailySummary({
        date,
        max_stride: pickPositive(cacheMetrics && cacheMetrics.max_stride_cm, cached.max_stride),
        avg_stride: pickPositive(cacheMetrics && cacheMetrics.avg_stride_cm, cached.avg_stride),
        hr_max: pickPositive(cacheMetrics && cacheMetrics.max_heart_rate, cached.hr_max),
        hr_avg: pickPositive(cacheMetrics && cacheMetrics.avg_heart_rate, cached.hr_avg),
        avg_cadence: pickPositive(cacheMetrics && cacheMetrics.avg_cadence, cached.avg_cadence),
        max_cadence: pickPositive(cacheMetrics && cacheMetrics.max_cadence, cached.max_cadence),
        avg_speed: pickPositive(cacheMetrics && cacheMetrics.avg_speed, cached.avg_speed),
        max_speed: pickPositive(cacheMetrics && cacheMetrics.max_speed, cached.max_speed),
        message: cached.message
      });
      return res.json({ advice: cached.message });
    }

    // Fetch images for this run to provide context to Gemini
    const images = await imageRepo.getImagesForRun(date);
    const imagePaths = images.map(img => path.join(process.cwd(), 'public/assets/store', img.stored_filename));

    const advice = await openaiService.generateCoachMessage({
      date,
      stepCount,
      totalDistanceKm,
      totalTime,
      avgStride,
      maxStride,
      avgHR,
      maxHR,
      avgCadence,
      maxCadence,
      avgSpeed,
      maxSpeed
    }, imagePaths);

    // Persist message + metrics, preferring cache/intraday source-of-truth.
    await repo.saveDailySummary({
      date,
      max_stride: pickPositive(cacheMetrics.max_stride_cm, maxStride),
      avg_stride: pickPositive(cacheMetrics.avg_stride_cm, 0),
      hr_max: pickPositive(cacheMetrics.max_heart_rate, maxHR),
      hr_avg: pickPositive(cacheMetrics.avg_heart_rate, 0),
      avg_cadence: pickPositive(cacheMetrics.avg_cadence, 0),
      max_cadence: pickPositive(cacheMetrics.max_cadence, maxCadence),
      avg_speed: pickPositive(cacheMetrics.avg_speed, 0),
      max_speed: pickPositive(cacheMetrics.max_speed, maxSpeed),
      message: advice
    });

    res.json({ advice });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- Static Files ---
// --- Static Files ---
// Enable serving of all static files (index.html, css, js, assets)
app.use(express.static(path.join(process.cwd(), 'public')));

// --- Server Start ---
if (require.main === module) {
  // 繧ｹ繝槭・縺九ｉ繧｢繧ｯ繧ｻ繧ｹ蜿ｯ閭ｽ縺ｫ縺吶ｋ (0.0.0.0)
  app.listen(port, '0.0.0.0', () => {
  });
}

module.exports = app;


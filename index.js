require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
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
const GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE = geminiService.TEMPORARY_UNAVAILABLE_MESSAGE || "現在利用が制限されています。しばらくお待ちください。";

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

function calculateAverageStrideCm(totalDistanceKm, stepCount) {
  const distanceKm = Number(totalDistanceKm || 0);
  const steps = Number(stepCount || 0);
  if (!(distanceKm > 0) || !(steps > 0)) return 0;
  return Number(((distanceKm * 100000) / steps).toFixed(1));
}

function correctBatchSummaryStepNoise(stepCount, totalTime, totalDistanceKm) {
  const rawSteps = Number(stepCount || 0);
  const sec = parseHmsToSeconds(totalTime);
  const distanceKm = Number(totalDistanceKm || 0);
  if (!(rawSteps > 0) || !(sec > 0)) {
    return {
      step_count: rawSteps,
      avg_cadence: 0,
      avg_stride_cm: 0,
      corrected: false
    };
  }

  const rawCadence = Math.round(rawSteps / (sec / 60));
  if (rawCadence <= 200) {
    return {
      step_count: rawSteps,
      avg_cadence: rawCadence,
      avg_stride_cm: distanceKm > 0 ? Number(((distanceKm * 100000) / rawSteps).toFixed(1)) : 0,
      corrected: false
    };
  }

  console.log(`[SYNC DAILY step correction] raw_step_count=${rawSteps} total_time=${totalTime} raw_avg_cadence=${rawCadence}`);

  const rawText = String(Math.round(rawSteps));
  if (rawText.length < 2) {
    return {
      step_count: rawSteps,
      avg_cadence: rawCadence,
      avg_stride_cm: distanceKm > 0 ? Number(((distanceKm * 100000) / rawSteps).toFixed(1)) : 0,
      corrected: false
    };
  }

  const trimmedSteps = Number(rawText.slice(1));
  if (!(trimmedSteps > 0)) {
    return {
      step_count: rawSteps,
      avg_cadence: rawCadence,
      avg_stride_cm: distanceKm > 0 ? Number(((distanceKm * 100000) / rawSteps).toFixed(1)) : 0,
      corrected: false
    };
  }

  return {
    step_count: trimmedSteps,
    avg_cadence: Math.round(trimmedSteps / (sec / 60)),
    avg_stride_cm: distanceKm > 0 ? Number(((distanceKm * 100000) / trimmedSteps).toFixed(1)) : 0,
    corrected: true
  };
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return defaultValue;
}

function normalizeRunDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalized = raw.replace(/\//g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

async function hasRunningActivitySignal(dateString) {
  try {
    const rawBucketsFile = path.join(__dirname, 'storage', 'cache', `raw_buckets_${dateString}.json`);
    const raw = await fs.readFile(rawBucketsFile, 'utf8');
    const buckets = JSON.parse(raw);
    if (!Array.isArray(buckets) || buckets.length === 0) return false;

    for (const bucket of buckets) {
      for (const ds of bucket.dataset || []) {
        const dsid = String(ds.dataSourceId || '').toLowerCase();
        if (!dsid.includes('activity.summary') && !dsid.includes('activity.segment')) continue;
        for (const p of ds.point || []) {
          for (const v of p.value || []) {
            if (Number(v?.intVal) === 8) return true;
          }
        }
      }
    }
    return false;
  } catch {
    return false;
  }
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
  const existingOcrAssetCount = await imageRepo.countOcrPersistedAssetsForRun(runDate);
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
  const isFirstOcrAssetForRun =
    existingOcrAssetCount === 0 && (
      currentStepCount > 0 ||
      currentTotalDistanceKm > 0 ||
      !!currentTotalTime
    );
  const correctedSummaryMetrics = correctBatchSummaryStepNoise(
    currentStepCount,
    currentTotalTime,
    currentTotalDistanceKm
  );
  const summaryStepCount = correctedSummaryMetrics.step_count > 0
    ? correctedSummaryMetrics.step_count
    : currentStepCount;
  const summaryAvgStride = correctedSummaryMetrics.avg_stride_cm > 0
    ? correctedSummaryMetrics.avg_stride_cm
    : currentAvgStride;
  const summaryAvgCadence = correctedSummaryMetrics.avg_cadence > 0
    ? correctedSummaryMetrics.avg_cadence
    : currentAvgCadence;

  const summary = {
    date: runDate,
    step_count: Math.round(mergePositiveSum(summaryStepCount, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.step_count), 0)),
    total_distance_km: mergePositiveSum(currentTotalDistanceKm, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.total_distance_km), 2),
    total_time: mergeTimeSum(currentTotalTime, isFirstOcrAssetForRun ? null : (existingSummary && existingSummary.total_time)),
    calories_kcal: Math.round(mergePositiveSum(currentCaloriesKcal, existingSummary && existingSummary.calories_kcal, 0)),
    max_stride: mergePositiveMax(currentMaxStride, existingSummary && existingSummary.max_stride, 1),
    avg_stride: 0,
    hr_max: mergePositiveMax(currentHrMax, existingSummary && existingSummary.hr_max, 0),
    hr_avg: mergePositiveAverage(currentHrAvg, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.hr_avg), 0),
    avg_cadence: mergePositiveAverage(summaryAvgCadence, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.avg_cadence), 0),
    max_cadence: mergePositiveMax(currentMaxCadence, existingSummary && existingSummary.max_cadence, 0),
    avg_speed: mergePositiveAverage(currentAvgSpeed, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.avg_speed), 1),
    max_speed: mergePositiveMax(currentMaxSpeed, existingSummary && existingSummary.max_speed, 1),
    message: null
  };
  summary.avg_stride = calculateAverageStrideCm(summary.total_distance_km, summary.step_count)
    || mergePositiveAverage(summaryAvgStride, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.avg_stride), 1);

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
    step_count: currentStepCount > 0 ? currentStepCount : null,
    total_distance_km: currentTotalDistanceKm > 0 ? currentTotalDistanceKm : null,
    total_time: currentTotalTime || null,
    avg_speed: currentAvgSpeed > 0 ? currentAvgSpeed : null,
    avg_heart_rate: currentHrAvg > 0 ? currentHrAvg : null,
    calories_kcal: currentCaloriesKcal > 0 ? currentCaloriesKcal : null,
    avg_stride_cm: currentAvgStride > 0 ? currentAvgStride : null
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

async function syncDailySummaryFromCache(date) {
  // Best-effort cache refresh for this date.
  try {
    await googleFitService.getIntradayMetrics(date);
  } catch {
    // Continue with existing cache files when API is unavailable.
  }

  const existing = await repo.getDailySummary(date);
  const cacheMetrics = await computeDailySummaryFromCache(date);
  const distanceKm = Number(cacheMetrics.total_distance_km || 0);
  const stepCount = Number(cacheMetrics.step_count || 0);
  const maxStride = Number(cacheMetrics.max_stride_cm || 0);
  const maxHr = Number(cacheMetrics.max_heart_rate || 0);
  const maxCadence = Number(cacheMetrics.max_cadence || 0);
  const hasRunningActivity = await hasRunningActivitySignal(date);
  const hasRunSignal = hasRunningActivity;

  if (!existing && !hasRunSignal) {
    return {
      success: true,
      skipped: true,
      reason: 'insufficient_run_signal_or_not_running',
      date,
      metrics: {
        step_count: stepCount,
        total_distance_km: distanceKm,
        max_stride_cm: maxStride,
        max_heart_rate: maxHr,
        max_cadence: maxCadence,
        has_running_activity: hasRunningActivity
      }
    };
  }

  await repo.saveDailySummary({
    date,
    step_count: Number(cacheMetrics.step_count || 0),
    total_distance_km: Number(cacheMetrics.total_distance_km || 0),
    total_time: cacheMetrics.total_time || null,
    calories_kcal: Number(cacheMetrics.calories_kcal || 0),
    avg_stride: Number(cacheMetrics.avg_stride_cm || 0),
    max_stride: Number(cacheMetrics.max_stride_cm || 0),
    hr_avg: Number(cacheMetrics.avg_heart_rate || 0),
    hr_max: Number(cacheMetrics.max_heart_rate || 0),
    avg_cadence: Number(cacheMetrics.avg_cadence || 0),
    max_cadence: Number(cacheMetrics.max_cadence || 0),
    avg_speed: Number(cacheMetrics.avg_speed || 0),
    max_speed: Number(cacheMetrics.max_speed || 0)
  });

  const summary = await repo.getDailySummary(date);
  return {
    success: true,
    source: 'cache',
    date,
    created: !existing,
    summary
  };
}

async function importInboxFilesToAssets(filenames = []) {
  const results = [];
  for (const file of filenames) {
    try {
      const inboxPath = path.join(imageService.INBOX_DIR, file);
      try {
        await fs.access(inboxPath);
      } catch {
        results.push({ file, status: 'error', error: 'File not found' });
        continue;
      }

      const fileBuffer = await fs.readFile(inboxPath);
      const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      const ext = path.extname(file).toLowerCase();
      const storedFilename = `${fileHash}${ext}`;
      const storePath = path.join(__dirname, 'public/assets/store', storedFilename);

      let asset = await imageRepo.findAssetByHash(fileHash);
      if (!asset) {
        await fs.copyFile(inboxPath, storePath);
        const assetId = await imageRepo.createAsset(fileHash, storedFilename, file);
        asset = {
          asset_id: assetId,
          stored_filename: storedFilename,
          original_filename: file
        };
      }

      results.push({
        file,
        status: 'success',
        asset_id: asset.asset_id,
        stored_filename: asset.stored_filename || storedFilename,
        original_filename: asset.original_filename || file
      });
    } catch (err) {
      results.push({
        file,
        status: 'error',
        error: err && err.message ? String(err.message) : 'Import failed'
      });
    }
  }
  return results;
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
    const mode = String((req.query && req.query.mode) || '').trim().toLowerCase();
    if (mode === 'image_reset') {
      const existingSummary = await repo.getDailySummary(id);
      const linkedImages = await imageRepo.getImagesForRun(id);
      if (!existingSummary && (!Array.isArray(linkedImages) || linkedImages.length === 0)) {
        return res.status(404).json({ error: 'Run not found' });
      }

      await repo.deleteRun(id, { removeAssets: true });
      const restored = await syncDailySummaryFromCache(id);
      return res.json({ success: true, restored });
    }

    const changes = await repo.deleteRun(id, {
      removeAssets: mode !== 'summary_only'
    });
    if (changes === 0) return res.status(404).json({ error: 'Run not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/debug/cache/:date', async (req, res) => {
  try {
    const date = normalizeRunDate(req.params && req.params.date);
    if (!date) return res.status(400).json({ error: 'Valid date is required (YYYY-MM-DD)' });

    const cacheDir = path.join(__dirname, 'storage', 'cache');
    const targets = [
      path.join(cacheDir, `raw_buckets_${date}.json`),
      path.join(cacheDir, `intraday_${date}.json`)
    ];

    let deleted = 0;
    for (const target of targets) {
      try {
        await fs.unlink(target);
        deleted += 1;
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
    }

    res.json({ success: true, deleted });
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

app.get('/api/sessions/:date', async (req, res) => {
  try {
    const date = normalizeRunDate(req.params && req.params.date);
    if (!date) return res.status(400).json({ error: 'Valid date is required (YYYY-MM-DD)' });
    const sessions = await googleFitService.fetchSessionsForDate(date);
    res.json(Array.isArray(sessions) ? sessions : []);
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

// 3.1 Create/Update Daily Summary from cache only (no image required)
app.post('/api/daily/:date/sync-cache', async (req, res) => {
  try {
    const date = normalizeRunDate(req.params && req.params.date);
    if (!date) return res.status(400).json({ error: 'Valid date is required (YYYY-MM-DD)' });
    const payload = await syncDailySummaryFromCache(date);
    res.json(payload);
  } catch (err) {
    console.error('Daily cache sync error:', err);
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
    const { filenames, skipAdvice, skipSummary } = req.body || {};
    if (!Array.isArray(filenames)) return res.status(400).json({ error: 'Invalid input' });
    const results = await imageService.importSelectedFiles(filenames, runId, {
      skipAdvice: skipAdvice === true,
      skipSummary: skipSummary === true
    });
    const failed = results.filter((row) => row && row.status !== 'success');
    if (failed.length > 0) {
      return res.status(422).json({
        error: 'Some selected images failed to import.',
        code: 'IMPORT_PARTIAL_FAILED',
        results
      });
    }
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/images/import-auto-link', async (req, res) => {
  try {
    const { filenames, ocr_mode } = req.body || {};
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'filenames is required' });
    }

    const requestedMode = String(ocr_mode || 'python').toLowerCase().trim() === 'vision' ? 'vision' : 'python';
    const imported = await importInboxFilesToAssets(filenames);
    const results = [];

    for (const row of imported) {
      if (!row || row.status !== 'success' || !row.stored_filename || !row.asset_id) {
        results.push(row);
        continue;
      }

      try {
        const analyzed = await ocrComponent.analyzeScreenOcr(row.stored_filename, requestedMode);
        const resolvedDate = analyzed && analyzed.date ? String(analyzed.date).trim() : '';
        if (!resolvedDate) {
          results.push({
            file: row.file,
            asset_id: row.asset_id,
            stored_filename: row.stored_filename,
            status: 'error',
            error: 'OCR date not found'
          });
          continue;
        }

        let summary = await repo.getDailySummary(resolvedDate);
        if (!summary) {
          await syncDailySummaryFromCache(resolvedDate);
          summary = await repo.getDailySummary(resolvedDate);
        }
        if (!summary) {
          results.push({
            file: row.file,
            asset_id: row.asset_id,
            stored_filename: row.stored_filename,
            resolved_date: resolvedDate,
            status: 'error',
            error: 'daily_summary not available for OCR date'
          });
          continue;
        }

        await imageRepo.updateAssetMetricsById(row.asset_id, {
          step_count: Number(analyzed && analyzed.step_count) > 0 ? Number(analyzed.step_count) : null,
          total_distance_km: Number(analyzed && analyzed.total_distance_km) > 0 ? Number(analyzed.total_distance_km) : null,
          total_time: analyzed && analyzed.total_time ? String(analyzed.total_time) : null,
          avg_speed: Number(analyzed && analyzed.avg_speed) > 0 ? Number(analyzed.avg_speed) : null,
          avg_heart_rate: Number(analyzed && analyzed.avg_heart_rate) > 0 ? Number(analyzed.avg_heart_rate) : null,
          calories_kcal: Number(analyzed && analyzed.calories_kcal) > 0 ? Number(analyzed.calories_kcal) : null,
          avg_stride_cm: Number(analyzed && analyzed.avg_stride_cm) > 0 ? Number(analyzed.avg_stride_cm) : null
        });
        await imageRepo.linkImageToRun(resolvedDate, row.asset_id);

        results.push({
          file: row.file,
          asset_id: row.asset_id,
          stored_filename: row.stored_filename,
          resolved_date: resolvedDate,
          status: 'success'
        });
      } catch (err) {
        results.push({
          file: row.file,
          asset_id: row.asset_id,
          stored_filename: row.stored_filename,
          status: 'error',
          error: err && err.message ? String(err.message) : 'Auto-link failed'
        });
      }
    }

    const success = results.filter((r) => r && r.status === 'success').length;
    const failed = results.length - success;
    res.json({
      success_count: success,
      failed_count: failed,
      requested_mode: requestedMode,
      results
    });
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
    const date = normalizeRunDate(req.query.date);
    if (!date) return res.status(400).json({ error: 'date is required' });
    const snapshotDate = normalizeRunDate(req.query.snapshot_date);

    const candidates = await imageRepo.getBatchCandidatesForDate(date);
    const rows = Array.isArray(candidates) ? candidates : [];
    const filtered = snapshotDate
      ? rows.filter((row) => String(row && row.snapshot_date ? row.snapshot_date : '').trim() === snapshotDate)
      : rows;
    res.json(filtered);
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
    const requestedSingleModeRaw = String((req.body && req.body.ocr_mode) || (req.body && req.body.mode) || 'vision').toLowerCase().trim();
    const requestedSingleMode = requestedSingleModeRaw === 'python' ? 'python' : 'vision';
    let executedSingleMode = null;
    const allowInputDateFallback = toBool(req.body && req.body.useInputDateFallback, true);
    const skipAdvice = toBool(req.body && req.body.skipAdvice, toBool(process.env.SKIP_ADVICE_GENERATION, false));

    const existingAsset = await imageRepo.findAssetByHash(fileHash);
    if (existingAsset) {
      // Multer already stored the file with a random filename; remove it for duplicate uploads.
      await fs.unlink(req.file.path).catch(() => { });
      let linkedRunId = null;
      if (allowInputDateFallback && forcedRunId) {
        const forcedSummary = await repo.getDailySummary(forcedRunId);
        // Do not create placeholder daily_summary by import date.
        // Link only if the target run already exists.
        if (forcedSummary) {
          await imageRepo.linkImageToRun(forcedRunId, existingAsset.asset_id);
          linkedRunId = forcedRunId;
        }
      }

      return res.json({
        success: true,
        ocr: {
          requested_mode: requestedSingleMode,
          executed_mode: executedSingleMode,
          status: 'skipped_duplicate'
        },
        data: {
          duplicate_upload: true,
          linked_run_id: linkedRunId,
          asset_id: existingAsset.asset_id,
          stored_filename: existingAsset.stored_filename || null,
          original_filename: existingAsset.original_filename || originalName,
          note: linkedRunId ? undefined : 'Duplicate detected. Not linked because target run was not found.'
        }
      });
    }

    const assetId = await imageRepo.createAsset(fileHash, filename, originalName);

    // 3. Main Analysis (Gemini)
    // If OCR fails, we still ingest the image and create/link the asset without crashing the request.
    
    let result = {};
    let ocrFailed = false;
    try {
      executedSingleMode = requestedSingleMode;
      const analyzed = await ocrComponent.analyzeScreenOcr(
        filename,
        requestedSingleMode
      );
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
          code: 'MISSING_RUN_DATE',
          ocr: {
            requested_mode: requestedSingleMode,
            executed_mode: executedSingleMode,
            status: 'failed'
          }
        });
      }

      const forcedSummary = await repo.getDailySummary(forcedRunId);
      result.date = forcedRunId;
      await imageRepo.updateAssetMetricsById(assetId, result);

      if (forcedSummary) {
        try {
          await imageRepo.linkImageToRun(forcedRunId, assetId);
        } catch (linkErr) {
          console.error("Link Failed (ignored):", linkErr && linkErr.message ? linkErr.message : linkErr);
        }
      }

      return res.json({
        success: true,
        ocr: {
          requested_mode: requestedSingleMode,
          executed_mode: executedSingleMode,
          status: 'failed_but_stored'
        },
        data: {
          ...result,
          asset_id: assetId,
          stored_filename: filename,
          original_filename: originalName,
          linked_run_id: forcedSummary ? forcedRunId : null,
          note: forcedSummary ? undefined : 'OCR failed. Image stored without run link because target run was not found.'
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
        code: 'MISSING_RUN_DATE',
        ocr: {
          requested_mode: requestedSingleMode,
          executed_mode: executedSingleMode,
          status: 'missing_run_date'
        }
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
      const existingOcrAssetCount = await imageRepo.countOcrPersistedAssetsForRun(result.date);
      const cacheMetrics = await computeDailySummaryFromCache(result.date);
      const isFirstOcrAssetForRun =
        existingOcrAssetCount === 0 && (
          Number(result.step_count || 0) > 0 ||
          Number(result.total_distance_km || 0) > 0 ||
          !!result.total_time
        );

      const correctedSummaryMetrics = correctBatchSummaryStepNoise(
        Number(result.step_count || 0),
        result.total_time || null,
        Number(result.total_distance_km || 0)
      );
      const correctedStepCount = correctedSummaryMetrics.step_count > 0
        ? correctedSummaryMetrics.step_count
        : Number(result.step_count || 0);
      const correctedAvgStride = correctedSummaryMetrics.avg_stride_cm > 0
        ? correctedSummaryMetrics.avg_stride_cm
        : Number(result.avg_stride_cm || 0);
      const correctedAvgCadence = correctedSummaryMetrics.avg_cadence > 0
        ? correctedSummaryMetrics.avg_cadence
        : Number(result.avg_cadence || 0);

      const summaryStepCount = pickPositive(correctedStepCount, cacheMetrics.step_count);
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
        
        const fitData = await googleFitService.getDailyMetrics(result.date);
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

      const safeAvgStride = (correctedAvgStride > 0) ? correctedAvgStride
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
        correctedAvgCadence,
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
      const mergedMaxHR = mergePositiveMax(safeMaxHR, existingSummary && existingSummary.hr_max, 0);
      const mergedAvgHR = mergePositiveAverage(safeAvgHR, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.hr_avg), 0);
      const mergedMaxCadence = mergePositiveMax(finalMaxCadence, existingSummary && existingSummary.max_cadence, 0);
      const mergedAvgCadence = mergePositiveAverage(finalAvgCadence, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.avg_cadence), 0);
      const mergedMaxSpeed = mergePositiveMax(finalMaxSpeed, existingSummary && existingSummary.max_speed, 1);
      const mergedAvgSpeed = mergePositiveAverage(finalAvgSpeed, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.avg_speed), 1);
      const mergedStepCount = Math.round(mergePositiveSum(summaryStepCount, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.step_count), 0));
      const mergedTotalDistanceKm = mergePositiveSum(summaryTotalDistanceKm, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.total_distance_km), 2);
      const mergedTotalTime = mergeTimeSum(summaryTotalTime, isFirstOcrAssetForRun ? null : (existingSummary && existingSummary.total_time));
      const mergedAvgStride = calculateAverageStrideCm(mergedTotalDistanceKm, mergedStepCount)
        || mergePositiveAverage(safeAvgStride, isFirstOcrAssetForRun ? 0 : (existingSummary && existingSummary.avg_stride), 1);

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

        const adviceToSave = (advice === GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE &&
          existingSummary &&
          String(existingSummary.message || '').trim().length > 0 &&
          String(existingSummary.message || '').trim() !== GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE)
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

    console.log(`[OCR /api/analyze] requested=${requestedSingleMode} executed=${executedSingleMode || 'none'} status=ok date=${result.date || 'null'} file=${filename}`);
    res.json({
      success: true,
      ocr: {
        requested_mode: requestedSingleMode,
        executed_mode: executedSingleMode,
        status: 'ok'
      },
      data: result
    });
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
    if (items.length === 0) {
      return res.status(400).json({ error: 'items is required (array)' });
    }

    const batchResult = await ocrComponent.analyzeBatchJob(payload);
    const requestedModeCounts = { vision: 0, python: 0, mock: 0, other: 0 };
    const executedModeCounts = { vision: 0, python: 0, mock: 0, other: 0 };
    for (const row of batchResult.results || []) {
      const requested = String(row?.input?.requested_mode || '').toLowerCase().trim();
      const executed = String(row?.mode || '').toLowerCase().trim();
      if (requested === 'vision' || requested === 'python' || requested === 'mock') requestedModeCounts[requested] += 1;
      else requestedModeCounts.other += 1;
      if (executed === 'vision' || executed === 'python' || executed === 'mock') executedModeCounts[executed] += 1;
      else executedModeCounts.other += 1;
    }
    console.log(`[OCR /api/analyze/batch] requested=${JSON.stringify(requestedModeCounts)} executed=${JSON.stringify(executedModeCounts)} total=${batchResult.total} success=${batchResult.success} failed=${batchResult.failed}`);

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
      if (row.mode !== 'vision' && row.mode !== 'python') {
        persistResults.push({
          item_id: row.item_id || null,
          ok: false,
          reason: 'OCR_MODE_NOT_ALLOWED',
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
    const persisted = {
      requested: true,
      total: persistResults.length,
      success: persistSuccess,
      failed: persistResults.length - persistSuccess,
      results: persistResults
    };

    return res.json({
      success: true,
      mode: 'batch',
      ...batchResult,
      ocr_modes: {
        requested: requestedModeCounts,
        executed: executedModeCounts
      },
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
    if (!date) return res.status(400).json({ error: 'date is required' });

    const dailySummary = await repo.getDailySummary(date);
    const cacheMetrics = await computeDailySummaryFromCache(date);
    const resolvedStepCount = pickPositive(dailySummary && dailySummary.step_count, pickPositive(cacheMetrics.step_count, stepCount));
    const resolvedTotalDistanceKm = pickPositive(dailySummary && dailySummary.total_distance_km, pickPositive(cacheMetrics.total_distance_km, totalDistanceKm));
    const resolvedTotalTime = pickText(dailySummary && dailySummary.total_time, pickText(cacheMetrics.total_time, totalTime));
    const resolvedAvgStride = pickPositive(dailySummary && dailySummary.avg_stride, pickPositive(cacheMetrics.avg_stride_cm, avgStride));
    const resolvedMaxStride = pickPositive(
      dailySummary && dailySummary.max_stride,
      mergePositiveMax(maxStride, cacheMetrics.max_stride_cm, 1)
    );
    const resolvedAvgHr = pickPositive(dailySummary && dailySummary.hr_avg, pickPositive(cacheMetrics.avg_heart_rate, avgHR));
    const resolvedMaxHr = pickPositive(dailySummary && dailySummary.hr_max, pickPositive(cacheMetrics.max_heart_rate, maxHR));
    const resolvedAvgCadence = pickPositive(dailySummary && dailySummary.avg_cadence, pickPositive(cacheMetrics.avg_cadence, avgCadence));
    const resolvedMaxCadence = pickPositive(dailySummary && dailySummary.max_cadence, pickPositive(cacheMetrics.max_cadence, maxCadence));
    const resolvedAvgSpeed = pickPositive(dailySummary && dailySummary.avg_speed, pickPositive(cacheMetrics.avg_speed, avgSpeed));
    const resolvedMaxSpeed = pickPositive(dailySummary && dailySummary.max_speed, pickPositive(cacheMetrics.max_speed, maxSpeed));

    // Fetch images for this run to provide context to Gemini
    const images = await imageRepo.getImagesForRun(date);
    const imagePaths = images.map(img => path.join(process.cwd(), 'public/assets/store', img.stored_filename));

    const advice = await openaiService.generateCoachMessage({
      date,
      stepCount: resolvedStepCount,
      totalDistanceKm: resolvedTotalDistanceKm,
      totalTime: resolvedTotalTime,
      avgStride: resolvedAvgStride,
      maxStride: resolvedMaxStride,
      avgHR: resolvedAvgHr,
      maxHR: resolvedMaxHr,
      avgCadence: resolvedAvgCadence,
      maxCadence: resolvedMaxCadence,
      avgSpeed: resolvedAvgSpeed,
      maxSpeed: resolvedMaxSpeed
    }, imagePaths);

    // Persist message + metrics, preferring cache/intraday source-of-truth.
    await repo.saveDailySummary({
      date,
      step_count: resolvedStepCount,
      total_distance_km: resolvedTotalDistanceKm,
      total_time: resolvedTotalTime,
      max_stride: resolvedMaxStride,
      avg_stride: resolvedAvgStride,
      hr_max: resolvedMaxHr,
      hr_avg: resolvedAvgHr,
      avg_cadence: resolvedAvgCadence,
      max_cadence: resolvedMaxCadence,
      avg_speed: resolvedAvgSpeed,
      max_speed: resolvedMaxSpeed,
      message: advice
    });

    res.json({ advice, provider: 'openai-live' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Advice API (Gemini)
app.post('/api/advice/gemini', async (req, res) => {
  try {
    const { date, stepCount, totalDistanceKm, totalTime, avgStride, maxStride, avgHR, maxHR, avgCadence, maxCadence, avgSpeed, maxSpeed } = req.body;
    if (!date) return res.status(400).json({ error: 'date is required' });

    const dailySummary = await repo.getDailySummary(date);
    const cacheMetrics = await computeDailySummaryFromCache(date);
    const resolvedStepCount = pickPositive(dailySummary && dailySummary.step_count, pickPositive(cacheMetrics.step_count, stepCount));
    const resolvedTotalDistanceKm = pickPositive(dailySummary && dailySummary.total_distance_km, pickPositive(cacheMetrics.total_distance_km, totalDistanceKm));
    const resolvedTotalTime = pickText(dailySummary && dailySummary.total_time, pickText(cacheMetrics.total_time, totalTime));
    const resolvedAvgStride = pickPositive(dailySummary && dailySummary.avg_stride, pickPositive(cacheMetrics.avg_stride_cm, avgStride));
    const resolvedMaxStride = pickPositive(
      dailySummary && dailySummary.max_stride,
      mergePositiveMax(maxStride, cacheMetrics.max_stride_cm, 1)
    );
    const resolvedAvgHr = pickPositive(dailySummary && dailySummary.hr_avg, pickPositive(cacheMetrics.avg_heart_rate, avgHR));
    const resolvedMaxHr = pickPositive(dailySummary && dailySummary.hr_max, pickPositive(cacheMetrics.max_heart_rate, maxHR));
    const resolvedAvgCadence = pickPositive(dailySummary && dailySummary.avg_cadence, pickPositive(cacheMetrics.avg_cadence, avgCadence));
    const resolvedMaxCadence = pickPositive(dailySummary && dailySummary.max_cadence, pickPositive(cacheMetrics.max_cadence, maxCadence));
    const resolvedAvgSpeed = pickPositive(dailySummary && dailySummary.avg_speed, pickPositive(cacheMetrics.avg_speed, avgSpeed));
    const resolvedMaxSpeed = pickPositive(dailySummary && dailySummary.max_speed, pickPositive(cacheMetrics.max_speed, maxSpeed));
    const images = await imageRepo.getImagesForRun(date);
    const imagePaths = images.map(img => path.join(process.cwd(), 'public/assets/store', img.stored_filename));

    const advice = await geminiService.generateAdvice({
      date,
      step_count: resolvedStepCount,
      total_distance_km: resolvedTotalDistanceKm,
      total_time: resolvedTotalTime,
      avg_stride_cm: resolvedAvgStride,
      max_stride_cm: resolvedMaxStride,
      avg_heart_rate: resolvedAvgHr,
      max_heart_rate: resolvedMaxHr,
      avg_cadence: resolvedAvgCadence,
      max_cadence: resolvedMaxCadence,
      avg_speed: resolvedAvgSpeed,
      max_speed: resolvedMaxSpeed
    }, imagePaths);

    await repo.saveDailySummary({
      date,
      step_count: resolvedStepCount,
      total_distance_km: resolvedTotalDistanceKm,
      total_time: resolvedTotalTime,
      max_stride: resolvedMaxStride,
      avg_stride: resolvedAvgStride,
      hr_max: resolvedMaxHr,
      hr_avg: resolvedAvgHr,
      avg_cadence: resolvedAvgCadence,
      max_cadence: resolvedMaxCadence,
      avg_speed: resolvedAvgSpeed,
      max_speed: resolvedMaxSpeed,
      message: advice
    });

    return res.json({ advice, provider: 'gemini-live' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
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

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
const TCX_DOWNLOAD_DIR = path.join(process.env.USERPROFILE || 'C:\\Users\\yuji_', 'CrossDevice', 'SO-54C', 'storage', 'Download');

function getLegacyTcxIntradayCachePath(dateString) {
  return path.join(__dirname, 'storage', 'cache', `tcx_intraday_${dateString}.json`);
}

function sanitizeTcxRunId(runId) {
  return String(runId || '').trim().replace(/[^0-9_-]/g, '');
}

function buildTcxRunId(dateString, timeString = '000000') {
  const normalizedDate = String(dateString || '').trim();
  const normalizedTime = String(timeString || '').trim().padStart(6, '0').slice(0, 6);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return '';
  return `${normalizedDate}_${normalizedTime}`;
}

function getTcxRunCachePath(runId) {
  const safeRunId = sanitizeTcxRunId(runId);
  return path.join(__dirname, 'storage', 'cache', `tcx_intraday_${safeRunId}.json`);
}

function formatLocalTimeLabel(timestampMs, withSeconds = false) {
  if (!Number.isFinite(Number(timestampMs))) return '';
  const d = new Date(Number(timestampMs));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

function buildTcxRunStamp(dateString, timeString) {
  const runId = buildTcxRunId(dateString, timeString);
  if (!runId) return null;
  const [year, month, day] = String(dateString).split('-').map(Number);
  const hh = Number(String(timeString || '000000').slice(0, 2));
  const mm = Number(String(timeString || '000000').slice(2, 4));
  const ss = Number(String(timeString || '000000').slice(4, 6));
  const startTimeMs = new Date(year, month - 1, day, hh, mm, ss, 0).getTime();
  return {
    dateString,
    timeString: String(timeString || '000000').slice(0, 6),
    runId,
    startTimeMs: Number.isFinite(startTimeMs) ? startTimeMs : null
  };
}

function extractRunStampFromTcxFilename(filename) {
  const text = String(filename || '').trim();
  if (!text) return null;
  const digits = text.replace(/[^0-9]/g, '');
  const m = digits.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([01][0-9]|2[0-3])([0-5][0-9])([0-5][0-9])/);
  if (m) {
    return buildTcxRunStamp(`${m[1]}-${m[2]}-${m[3]}`, `${m[4]}${m[5]}${m[6]}`);
  }
  const dateOnly = digits.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/);
  if (!dateOnly) return null;
  return buildTcxRunStamp(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, '000000');
}

function extractRunDateFromTcxFilename(filename) {
  return extractRunStampFromTcxFilename(filename)?.dateString || '';
}

function getTokyoMinuteLabel(timestampMs) {
  const date = new Date(Number(timestampMs));
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function floorToMinuteMs(timestampMs) {
  const date = new Date(Number(timestampMs));
  date.setSeconds(0, 0);
  return date.getTime();
}

function parseTcxTrackpoints(xmlText) {
  const blocks = String(xmlText || '').match(/<Trackpoint>[\s\S]*?<\/Trackpoint>/g) || [];
  return blocks.map((block) => {
    const time = (block.match(/<Time>([^<]+)<\/Time>/) || [])[1] || null;
    const distance = (block.match(/<DistanceMeters>([^<]+)<\/DistanceMeters>/) || [])[1] || null;
    const altitude = (block.match(/<AltitudeMeters>([^<]+)<\/AltitudeMeters>/) || [])[1] || null;
    const heartRate = (block.match(/<HeartRateBpm>\s*<Value>([^<]+)<\/Value>\s*<\/HeartRateBpm>/) || [])[1] || null;
    const cadence = (block.match(/<Cadence>([^<]+)<\/Cadence>/) || [])[1] || null;
    const speed = (block.match(/<Speed>([^<]+)<\/Speed>/) || [])[1] || null;
    const timestampMs = time ? Date.parse(time) : NaN;
    return {
      timestampMs,
      distanceMeters: Number.isFinite(Number(distance)) ? Number(distance) : null,
      altitudeMeters: Number.isFinite(Number(altitude)) ? Number(altitude) : null,
      heartRate: Number.isFinite(Number(heartRate)) ? Number(heartRate) : null,
      cadence: Number.isFinite(Number(cadence)) ? Number(cadence) : null,
      speedMps: Number.isFinite(Number(speed)) ? Number(speed) : null
    };
  }).filter((point) => Number.isFinite(point.timestampMs)).sort((a, b) => a.timestampMs - b.timestampMs);
}

function extractRunStampFromTcxXml(xmlText) {
  const text = String(xmlText || '');
  const activityId = (text.match(/<Activity\b[^>]*>[\s\S]*?<Id>([^<]+)<\/Id>/) || [])[1] || '';
  const lapStart = (text.match(/<Lap\b[^>]*StartTime="([^"]+)"/) || [])[1] || '';
  const source = String(activityId || lapStart || '').trim();
  if (!source) return null;
  const timestampMs = Date.parse(source);
  if (!Number.isFinite(timestampMs)) return null;
  const d = new Date(timestampMs);
  return buildTcxRunStamp(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`
  );
}

function extractRunDateFromTcxXml(xmlText) {
  return extractRunStampFromTcxXml(xmlText)?.dateString || '';
}

function buildTcxMinuteChartData(trackpoints) {
  const minuteMap = new Map();
  let previousDistanceMeters = null;

  for (const point of trackpoints) {
    const minuteStartMs = floorToMinuteMs(point.timestampMs);
    if (!minuteMap.has(minuteStartMs)) {
      minuteMap.set(minuteStartMs, {
        time: getTokyoMinuteLabel(minuteStartMs),
        bucketStartMs: minuteStartMs,
        distance: 0,
        speedSum: 0,
        speedCount: 0,
        heartRateSum: 0,
        heartRateCount: 0,
        altitudeSum: 0,
        altitudeCount: 0,
        coverageSeconds: 0,
        pitchSum: 0,
        pitchCount: 0
      });
    }

    const bucket = minuteMap.get(minuteStartMs);
    bucket.coverageSeconds += 1;
    if (Number.isFinite(point.distanceMeters) && Number.isFinite(previousDistanceMeters)) {
      const delta = point.distanceMeters - previousDistanceMeters;
      if (delta > 0) bucket.distance += delta;
    }
    if (Number.isFinite(point.distanceMeters)) {
      previousDistanceMeters = point.distanceMeters;
    }
    // COROS-exported TCX Speed is already aligned with the values we want to
    // observe in km/h-like display terms for this app. Do not scale again.
    if (Number.isFinite(point.speedMps) && point.speedMps > 0) {
      bucket.speedSum += point.speedMps;
      bucket.speedCount += 1;
    }
    if (Number.isFinite(point.heartRate) && point.heartRate > 0) {
      bucket.heartRateSum += point.heartRate;
      bucket.heartRateCount += 1;
    }
    if (Number.isFinite(point.altitudeMeters)) {
      bucket.altitudeSum += point.altitudeMeters;
      bucket.altitudeCount += 1;
    }
    if (Number.isFinite(point.cadence) && point.cadence > 0) {
      bucket.pitchSum += point.cadence * 2;
      bucket.pitchCount += 1;
    }
  }

  return Array.from(minuteMap.values())
    .sort((a, b) => a.bucketStartMs - b.bucketStartMs)
    .map((bucket) => {
      const distance = Number(bucket.distance.toFixed(1));
      const pitch = bucket.pitchCount > 0 ? Math.round(bucket.pitchSum / bucket.pitchCount) : 0;
      const stride = pitch > 0 && distance > 0
        ? Number(((distance / pitch) * 100).toFixed(1))
        : 0;
      return {
        time: bucket.time,
        bucketStartMs: bucket.bucketStartMs,
        coverageSeconds: bucket.coverageSeconds,
        distance,
        stride,
        speed: bucket.speedCount > 0 ? Number((bucket.speedSum / bucket.speedCount).toFixed(1)) : 0,
        heartRate: bucket.heartRateCount > 0 ? Math.round(bucket.heartRateSum / bucket.heartRateCount) : 0,
        pitch,
        altitude: bucket.altitudeCount > 0 ? Number((bucket.altitudeSum / bucket.altitudeCount).toFixed(1)) : null
      };
    });
}

function dailySummaryCoreDiffers(existing, nextSummary) {
  if (!existing || !nextSummary) return true;
  const numericKeys = [
    'step_count',
    'total_distance_km',
    'max_stride',
    'avg_stride',
    'hr_avg',
    'hr_max',
    'avg_cadence',
    'max_cadence',
    'avg_speed',
    'max_speed'
  ];
  for (const key of numericKeys) {
    const a = Number(existing[key] || 0);
    const b = Number(nextSummary[key] || 0);
    if (Math.abs(a - b) > 0.05) return true;
  }
  return String(existing.total_time || '') !== String(nextSummary.total_time || '');
}

async function regenerateDailySummaryMessageFromStoredData(dateString, existingMessage = null) {
  const dailySummary = await repo.getDailySummary(dateString);
  if (!dailySummary) return existingMessage || null;

  const cacheMetrics = await computeDailySummaryFromCache(dateString);
  const resolvedStepCount = pickPositive(dailySummary.step_count, cacheMetrics.step_count);
  const resolvedTotalDistanceKm = pickPositive(dailySummary.total_distance_km, cacheMetrics.total_distance_km);
  const resolvedTotalTime = pickText(dailySummary.total_time, cacheMetrics.total_time);
  const resolvedAvgStride = pickPositive(dailySummary.avg_stride, cacheMetrics.avg_stride_cm);
  const resolvedMaxStride = pickPositive(dailySummary.max_stride, cacheMetrics.max_stride_cm);
  const resolvedAvgHr = pickPositive(dailySummary.hr_avg, cacheMetrics.avg_heart_rate);
  const resolvedMaxHr = pickPositive(dailySummary.hr_max, cacheMetrics.max_heart_rate);
  const resolvedAvgCadence = pickPositive(dailySummary.avg_cadence, cacheMetrics.avg_cadence);
  const resolvedMaxCadence = pickPositive(dailySummary.max_cadence, cacheMetrics.max_cadence);
  const resolvedAvgSpeed = pickPositive(dailySummary.avg_speed, cacheMetrics.avg_speed);
  const resolvedMaxSpeed = pickPositive(dailySummary.max_speed, cacheMetrics.max_speed);

  const images = await imageRepo.getImagesForRun(dateString);
  const imagePaths = images.map((img) => path.join(process.cwd(), 'public/assets/store', img.stored_filename));

  try {
    const advice = await openaiService.generateCoachMessage({
      date: dateString,
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

    const normalized = String(advice || '').trim();
    if (!normalized || normalized === 'No API Key' || normalized === 'AI message is empty.') {
      return existingMessage || dailySummary.message || null;
    }
    return normalized;
  } catch {
    return existingMessage || dailySummary.message || null;
  }
}

async function readTcxMinuteCache(dateString) {
  try {
    const raw = await fs.readFile(getLegacyTcxIntradayCachePath(dateString), 'utf8');
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

async function readTcxMinuteRunCache(runId) {
  try {
    const raw = await fs.readFile(getTcxRunCachePath(runId), 'utf8');
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

async function writeTcxMinuteCache(dateString, rows) {
  const cachePath = getLegacyTcxIntradayCachePath(dateString);
  await fs.writeFile(cachePath, JSON.stringify(rows, null, 2), 'utf8');
  return cachePath;
}

async function writeTcxMinuteRunCache(runId, rows) {
  const cachePath = getTcxRunCachePath(runId);
  await fs.writeFile(cachePath, JSON.stringify(rows, null, 2), 'utf8');
  return cachePath;
}

async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

async function listTcxRunDescriptorsForDate(dateString) {
  const normalizedDate = String(dateString || '').trim();
  const ymd = normalizedDate.replace(/-/g, '');
  if (!/^\d{8}$/.test(ymd)) return [];

  const cacheDir = path.join(__dirname, 'storage', 'cache');
  let names = [];
  try {
    names = await fs.readdir(TCX_DOWNLOAD_DIR);
  } catch {
    names = [];
  }
  let cacheNames = [];
  try {
    cacheNames = await fs.readdir(cacheDir);
  } catch {
    cacheNames = [];
  }

  const runMap = new Map();
  for (const name of names) {
    if (!/\.tcx$/i.test(name) || !name.includes(ymd)) continue;
    const stamp = extractRunStampFromTcxFilename(name);
    if (!stamp || stamp.dateString !== normalizedDate || !stamp.runId) continue;
    runMap.set(stamp.runId, {
      runId: stamp.runId,
      date: stamp.dateString,
      timeString: stamp.timeString,
      startTimeMs: stamp.startTimeMs,
      startTimeLabel: formatLocalTimeLabel(stamp.startTimeMs),
      filename: name,
      tcxPath: path.join(TCX_DOWNLOAD_DIR, name),
      cachePath: getTcxRunCachePath(stamp.runId),
      legacy: false
    });
  }

  for (const cacheName of cacheNames) {
    const match = String(cacheName).match(/^tcx_intraday_(20\d{2}-\d{2}-\d{2})_(\d{6})\.json$/);
    if (!match) continue;
    const stamp = buildTcxRunStamp(match[1], match[2]);
    if (!stamp || stamp.dateString !== normalizedDate || !stamp.runId) continue;
    if (runMap.has(stamp.runId)) continue;
    runMap.set(stamp.runId, {
      runId: stamp.runId,
      date: stamp.dateString,
      timeString: stamp.timeString,
      startTimeMs: stamp.startTimeMs,
      startTimeLabel: formatLocalTimeLabel(stamp.startTimeMs),
      filename: cacheName,
      tcxPath: null,
      cachePath: path.join(cacheDir, cacheName),
      legacy: false
    });
  }

  const descriptors = Array.from(runMap.values()).sort((a, b) => {
    const aMs = Number.isFinite(Number(a.startTimeMs)) ? Number(a.startTimeMs) : Number.MAX_SAFE_INTEGER;
    const bMs = Number.isFinite(Number(b.startTimeMs)) ? Number(b.startTimeMs) : Number.MAX_SAFE_INTEGER;
    return aMs - bMs;
  });
  if (descriptors.length > 0) return descriptors;

  const legacyCachePath = getLegacyTcxIntradayCachePath(normalizedDate);
  if (await fileExists(legacyCachePath)) {
    return [{
      runId: normalizedDate,
      date: normalizedDate,
      timeString: '',
      startTimeMs: null,
      startTimeLabel: normalizedDate,
      filename: path.basename(legacyCachePath),
      tcxPath: null,
      cachePath: legacyCachePath,
      legacy: true
    }];
  }

  return [];
}

async function loadTcxMinuteRowsForDescriptor(descriptor) {
  if (!descriptor) return { rows: [], tcxPath: null, cachePath: null };
  if (descriptor.legacy) {
    const rows = await readTcxMinuteCache(descriptor.date);
    return {
      rows: Array.isArray(rows) ? rows : [],
      tcxPath: null,
      cachePath: descriptor.cachePath || getLegacyTcxIntradayCachePath(descriptor.date)
    };
  }

  const cachedRows = await readTcxMinuteRunCache(descriptor.runId);
  if (Array.isArray(cachedRows) && cachedRows.length > 0) {
    return {
      rows: cachedRows,
      tcxPath: descriptor.tcxPath || null,
      cachePath: descriptor.cachePath || getTcxRunCachePath(descriptor.runId)
    };
  }

  if (!descriptor.tcxPath) {
    return { rows: [], tcxPath: null, cachePath: descriptor.cachePath || null };
  }

  const xmlText = await fs.readFile(descriptor.tcxPath, 'utf8');
  const trackpoints = parseTcxTrackpoints(xmlText);
  const rows = buildTcxMinuteChartData(trackpoints);
  const cachePath = rows.length > 0
    ? await writeTcxMinuteRunCache(descriptor.runId, rows)
    : descriptor.cachePath || getTcxRunCachePath(descriptor.runId);
  return {
    rows,
    tcxPath: descriptor.tcxPath,
    cachePath
  };
}

async function persistComputedTcxSummary(dateString, computed) {
  if (!computed || !computed.summary) {
    return {
      success: true,
      skipped: true,
      source: 'tcx',
      date: dateString,
      summary: null
    };
  }

  const existing = await repo.getDailySummary(dateString);
  const shouldRefreshMessage =
    dailySummaryCoreDiffers(existing, computed.summary) ||
    !(typeof existing?.message === 'string' && existing.message.trim());

  await repo.saveDailySummaryExact({
    ...computed.summary,
    message: existing ? existing.message : null
  });

  if (shouldRefreshMessage) {
    const refreshedMessage = await regenerateDailySummaryMessageFromStoredData(
      dateString,
      existing ? existing.message : null
    );
    if (refreshedMessage && String(refreshedMessage).trim()) {
      await repo.saveDailySummaryExact({
        ...computed.summary,
        message: refreshedMessage
      });
    }
  }

  const summary = await repo.getDailySummary(dateString);
  return {
    success: true,
    source: computed.source || 'tcx',
    date: dateString,
    created: !existing,
    tcxPath: computed.tcxPath || null,
    cachePath: computed.cachePath || null,
    summary
  };
}

function computeDailySummaryFromTcxRows(dateString, minuteRows, meta = {}) {
  if (!Array.isArray(minuteRows) || minuteRows.length === 0) return null;

  let totalDistanceMeters = 0;
  let totalCoverageSeconds = 0;
  let estimatedSteps = 0;
  let maxStride = 0;
  let maxHr = 0;
  let sumHr = 0;
  let countHr = 0;
  let maxPitch = 0;
  let sumPitch = 0;
  let countPitch = 0;
  let maxSpeed = 0;
  let sumSpeed = 0;
  let countSpeed = 0;

  for (const row of minuteRows) {
    const distance = Number(row.distance) || 0;
    const coverageSeconds = Number(row.coverageSeconds) || 0;
    const pitch = Number(row.pitch) || 0;
    const stride = Number(row.stride) || 0;
    const heartRate = Number(row.heartRate) || 0;
    const speed = Number(row.speed) || 0;

    totalDistanceMeters += distance;
    totalCoverageSeconds += coverageSeconds;
    if (pitch > 0 && coverageSeconds > 0) {
      estimatedSteps += (pitch * coverageSeconds) / 60;
      sumPitch += pitch;
      countPitch += 1;
      if (pitch > maxPitch) maxPitch = pitch;
    }
    if (stride > 0 && stride > maxStride) maxStride = stride;
    if (heartRate > 0) {
      sumHr += heartRate;
      countHr += 1;
      if (heartRate > maxHr) maxHr = heartRate;
    }
    if (speed > 0) {
      sumSpeed += speed;
      countSpeed += 1;
      if (speed > maxSpeed) maxSpeed = speed;
    }
  }

  const totalDistanceKm = Number((totalDistanceMeters / 1000).toFixed(2));
  const stepCount = Math.round(estimatedSteps);
  const totalTime = totalCoverageSeconds > 0 ? secondsToHms(totalCoverageSeconds) : null;
  const avgStride = calculateAverageStrideCm(totalDistanceKm, stepCount) || 0;

  return {
    source: meta.source || 'tcx',
    tcxPath: meta.tcxPath || null,
    cachePath: meta.cachePath || null,
    summary: {
      date: dateString,
      step_count: stepCount,
      total_distance_km: totalDistanceKm,
      total_time: totalTime,
      calories_kcal: 0,
      max_stride: Number(maxStride > 0 ? maxStride.toFixed(1) : '0'),
      avg_stride: avgStride,
      hr_max: Math.round(maxHr || 0),
      hr_avg: countHr > 0 ? Math.round(sumHr / countHr) : 0,
      avg_cadence: countPitch > 0 ? Math.round(sumPitch / countPitch) : 0,
      max_cadence: Math.round(maxPitch || 0),
      avg_speed: countSpeed > 0 ? Number((sumSpeed / countSpeed).toFixed(1)) : 0,
      max_speed: Number(maxSpeed > 0 ? maxSpeed.toFixed(1) : '0')
    }
  };
}

async function computeDailySummaryFromTcx(dateString) {
  const descriptors = await listTcxRunDescriptorsForDate(dateString);
  if (Array.isArray(descriptors) && descriptors.length > 0) {
    const combinedRows = [];
    const tcxPaths = [];
    const cachePaths = [];

    for (const descriptor of descriptors) {
      const loaded = await loadTcxMinuteRowsForDescriptor(descriptor);
      if (Array.isArray(loaded.rows) && loaded.rows.length > 0) {
        combinedRows.push(...loaded.rows);
      }
      if (loaded.tcxPath) tcxPaths.push(loaded.tcxPath);
      if (loaded.cachePath) cachePaths.push(loaded.cachePath);
    }

    if (combinedRows.length > 0) {
      combinedRows.sort((a, b) => Number(a.bucketStartMs || 0) - Number(b.bucketStartMs || 0));
      return computeDailySummaryFromTcxRows(dateString, combinedRows, {
        source: descriptors.some((descriptor) => !descriptor.legacy) ? 'tcx-runs' : 'tcx-cache',
        tcxPath: tcxPaths.length === 1 ? tcxPaths[0] : null,
        cachePath: cachePaths.length === 1 ? cachePaths[0] : null
      });
    }
  }

  const cachedRows = await readTcxMinuteCache(dateString);
  if (Array.isArray(cachedRows) && cachedRows.length > 0) {
    return computeDailySummaryFromTcxRows(dateString, cachedRows, {
      source: 'tcx-cache',
      cachePath: getLegacyTcxIntradayCachePath(dateString)
    });
  }

  const tcxPath = await findTcxFileForDate(dateString);
  if (!tcxPath) return null;

  const xmlText = await fs.readFile(tcxPath, 'utf8');
  const trackpoints = parseTcxTrackpoints(xmlText);
  if (!Array.isArray(trackpoints) || trackpoints.length === 0) return null;

  const minuteRows = buildTcxMinuteChartData(trackpoints);
  if (!Array.isArray(minuteRows) || minuteRows.length === 0) return null;

  return computeDailySummaryFromTcxRows(dateString, minuteRows, {
    source: 'tcx',
    tcxPath
  });
}

async function findTcxFileForDate(dateString) {
  const ymd = String(dateString || '').replace(/-/g, '');
  if (!/^\d{8}$/.test(ymd)) return null;
  let names = [];
  try {
    names = await fs.readdir(TCX_DOWNLOAD_DIR);
  } catch {
    return null;
  }
  const candidates = names
    .filter((name) => /\.tcx$/i.test(name) && name.includes(ymd))
    .sort();
  if (candidates.length === 0) return null;
  return path.join(TCX_DOWNLOAD_DIR, candidates[candidates.length - 1]);
}

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

  // Validate trimmed result before accepting it. Ensure cadence and stride
  // fall into plausible ranges; otherwise reject the trimming.
  const candidateAvgCadence = Math.round(trimmedSteps / (sec / 60));
  const candidateAvgStride = distanceKm > 0 ? Number(((distanceKm * 100000) / trimmedSteps).toFixed(1)) : 0;
  const cadenceOk = candidateAvgCadence >= 30 && candidateAvgCadence <= 200;
  const strideOk = candidateAvgStride >= 30 && candidateAvgStride <= 150;
  if (cadenceOk && strideOk) {
    return {
      step_count: trimmedSteps,
      avg_cadence: candidateAvgCadence,
      avg_stride_cm: candidateAvgStride,
      corrected: true
    };
  }

  console.log(`[SYNC DAILY step correction REJECTED] raw_step_count=${rawSteps} trimmed=${trimmedSteps} candidate_cadence=${candidateAvgCadence} candidate_stride=${candidateAvgStride}`);
  return {
    step_count: rawSteps,
    avg_cadence: rawCadence,
    avg_stride_cm: distanceKm > 0 ? Number(((distanceKm * 100000) / rawSteps).toFixed(1)) : 0,
    corrected: false
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
  const cacheMetrics = await computeDailySummaryFromCache(runDate);

  const summary = {
    date: runDate,
    step_count: Math.round(pickPositive(cacheMetrics.step_count, existingSummary && existingSummary.step_count)),
    total_distance_km: Number(pickPositive(cacheMetrics.total_distance_km, existingSummary && existingSummary.total_distance_km).toFixed(2)),
    total_time: pickText(cacheMetrics.total_time, existingSummary && existingSummary.total_time),
    calories_kcal: Math.round(pickPositive(cacheMetrics.calories_kcal, existingSummary && existingSummary.calories_kcal)),
    max_stride: Number(pickPositive(cacheMetrics.max_stride_cm, existingSummary && existingSummary.max_stride).toFixed(1)),
    avg_stride: 0,
    hr_max: Math.round(pickPositive(cacheMetrics.max_heart_rate, existingSummary && existingSummary.hr_max)),
    hr_avg: Math.round(pickPositive(cacheMetrics.avg_heart_rate, existingSummary && existingSummary.hr_avg)),
    avg_cadence: Math.round(pickPositive(cacheMetrics.avg_cadence, existingSummary && existingSummary.avg_cadence)),
    max_cadence: Math.round(pickPositive(cacheMetrics.max_cadence, existingSummary && existingSummary.max_cadence)),
    avg_speed: Number(pickPositive(cacheMetrics.avg_speed, existingSummary && existingSummary.avg_speed).toFixed(1)),
    max_speed: Number(pickPositive(cacheMetrics.max_speed, existingSummary && existingSummary.max_speed).toFixed(1)),
    message: existingSummary ? existingSummary.message : null
  };
  summary.avg_stride = calculateAverageStrideCm(summary.total_distance_km, summary.step_count)
    || Number(pickPositive(cacheMetrics.avg_stride_cm, existingSummary && existingSummary.avg_stride).toFixed(1));

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

async function syncDailySummaryFromTcx(date) {
  const dateString = normalizeRunDate(date);
  if (!dateString) throw new Error('Valid date is required (YYYY-MM-DD)');

  const computed = await computeDailySummaryFromTcx(dateString);
  return persistComputedTcxSummary(dateString, computed);
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

    const formattedRuns = await Promise.all(rawRuns.map(async (originalRow) => {
      let row = originalRow;
      if (includeDerived) {
        const refreshedFromTcx = await syncDailySummaryFromTcx(row.date).catch(() => null);
        const refreshedSummary = refreshedFromTcx && refreshedFromTcx.summary ? refreshedFromTcx.summary : null;
        if (refreshedSummary) {
          row = {
            ...row,
            step_count: refreshedSummary.step_count ?? row.step_count,
            total_distance_km: refreshedSummary.total_distance_km ?? row.total_distance_km,
            total_time: refreshedSummary.total_time ?? row.total_time,
            calories_kcal: refreshedSummary.calories_kcal ?? row.calories_kcal,
            avg_stride: refreshedSummary.avg_stride ?? row.avg_stride,
            hr_avg: refreshedSummary.hr_avg ?? row.hr_avg,
            max_stride: refreshedSummary.max_stride ?? row.max_stride,
            hr_max: refreshedSummary.hr_max ?? row.hr_max,
            avg_cadence: refreshedSummary.avg_cadence ?? row.avg_cadence,
            max_cadence: refreshedSummary.max_cadence ?? row.max_cadence,
            avg_speed: refreshedSummary.avg_speed ?? row.avg_speed,
            max_speed: refreshedSummary.max_speed ?? row.max_speed,
            message: refreshedSummary.message ?? row.message
          };
        }
      }
      const isMissingCoreRunMetrics =
        !(Number(row?.step_count) > 0) ||
        !(Number(row?.total_distance_km) > 0) ||
        !(typeof row?.total_time === 'string' && row.total_time.trim());

      if (includeDerived && isMissingCoreRunMetrics) {
        const refreshed = await syncDailySummaryFromCache(row.date).catch(() => null);
        const refreshedSummary = refreshed && refreshed.summary ? refreshed.summary : null;
        if (refreshedSummary) {
          row = {
            ...row,
            step_count: refreshedSummary.step_count ?? row.step_count,
            total_distance_km: refreshedSummary.total_distance_km ?? row.total_distance_km,
            total_time: refreshedSummary.total_time ?? row.total_time,
            calories_kcal: refreshedSummary.calories_kcal ?? row.calories_kcal,
            avg_stride: refreshedSummary.avg_stride ?? row.avg_stride,
            hr_avg: refreshedSummary.hr_avg ?? row.hr_avg,
            max_stride: refreshedSummary.max_stride ?? row.max_stride,
            hr_max: refreshedSummary.hr_max ?? row.hr_max,
            avg_cadence: refreshedSummary.avg_cadence ?? row.avg_cadence,
            max_cadence: refreshedSummary.max_cadence ?? row.max_cadence,
            avg_speed: refreshedSummary.avg_speed ?? row.avg_speed,
            max_speed: refreshedSummary.max_speed ?? row.max_speed,
            message: refreshedSummary.message ?? row.message
          };
        }
      }

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

app.get('/api/fit-speed', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date required' });

    const result = await googleFitService.getDetailedFitSpeedSeries(String(date).trim());
    const points = Array.isArray(result?.points) ? result.points : [];
    const chartData = points.map((point) => {
      const startMs = Math.floor(Number(point?.startTimeNanos || 0) / 1000000);
      const speedMs = Number(point?.value?.[0]?.fpVal || 0);
      return {
        time: Number.isFinite(startMs)
          ? new Date(startMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '00:00:00',
        timestampMs: Number.isFinite(startMs) ? startMs : null,
        speedMs,
        speedKmh: Number((speedMs * 3.6).toFixed(3)),
        originDataSourceId: point?.originDataSourceId || null
      };
    });

    res.json({
      date: String(date).trim(),
      dataSourceId: result?.dataSourceId || null,
      pointCount: chartData.length,
      chartData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fit-hr', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date required' });

    const result = await googleFitService.getDetailedFitHeartRateSeries(String(date).trim());
    const points = Array.isArray(result?.points) ? result.points : [];
    const chartData = points.map((point) => {
      const startMs = Math.floor(Number(point?.startTimeNanos || 0) / 1000000);
      const heartRate = Number(point?.value?.[0]?.fpVal ?? point?.value?.[0]?.intVal ?? 0);
      return {
        time: Number.isFinite(startMs)
          ? new Date(startMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '00:00:00',
        timestampMs: Number.isFinite(startMs) ? startMs : null,
        heartRate,
        originDataSourceId: point?.originDataSourceId || null
      };
    });

    res.json({
      date: String(date).trim(),
      dataSourceId: result?.dataSourceId || null,
      pointCount: chartData.length,
      chartData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function normalizeRunSessions(sessions = []) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter((session) => Number(session?.activityType) === 8)
    .map((session) => ({
      startMs: Number(session?.startTimeMillis),
      endMs: Number(session?.endTimeMillis)
    }))
    .filter((session) => Number.isFinite(session.startMs) && Number.isFinite(session.endMs) && session.endMs > session.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}

function pointOverlapsRunSessions(startMs, endMs, runSessions = []) {
  if (!Number.isFinite(startMs)) return false;
  const safeEndMs = Number.isFinite(endMs) && endMs > startMs ? endMs : startMs + 1;
  return runSessions.some((session) => safeEndMs > session.startMs && startMs < session.endMs);
}

app.get('/api/fit-pitch', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date required' });

    const runSessions = normalizeRunSessions(await googleFitService.fetchSessionsForDate(String(date).trim()));
    const result = await googleFitService.getDetailedFitPitchSeries(String(date).trim());
    const points = (Array.isArray(result?.points) ? result.points : []).filter((point) => {
      const startMs = Math.floor(Number(point?.startTimeNanos || 0) / 1000000);
      const endMs = Math.floor(Number(point?.endTimeNanos || 0) / 1000000);
      return pointOverlapsRunSessions(startMs, endMs, runSessions);
    });
    const chartData = points.map((point) => {
      const startMs = Math.floor(Number(point?.startTimeNanos || 0) / 1000000);
      const endMs = Math.floor(Number(point?.endTimeNanos || 0) / 1000000);
      const steps = Number(point?.value?.[0]?.intVal || 0);
      const durationSeconds = endMs > startMs ? (endMs - startMs) / 1000 : 0;
      return {
        time: Number.isFinite(startMs)
          ? new Date(startMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '00:00:00',
        endTime: Number.isFinite(endMs)
          ? new Date(endMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '00:00:00',
        timestampMs: Number.isFinite(startMs) ? startMs : null,
        endTimestampMs: Number.isFinite(endMs) ? endMs : null,
        steps,
        durationSeconds,
        pitchSpm: durationSeconds > 0 ? Number(((steps / durationSeconds) * 60).toFixed(3)) : null,
        originDataSourceId: point?.originDataSourceId || null
      };
    });

    res.json({
      date: String(date).trim(),
      dataSourceId: result?.dataSourceId || null,
      pointCount: chartData.length,
      chartData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fit-stride', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: 'Date required' });

    const [runSessions, pitchResult, speedResult] = await Promise.all([
      googleFitService.fetchSessionsForDate(String(date).trim()).then(normalizeRunSessions),
      googleFitService.getDetailedFitPitchSeries(String(date).trim()),
      googleFitService.getDetailedFitSpeedSeries(String(date).trim())
    ]);

    const pitchPoints = (Array.isArray(pitchResult?.points) ? pitchResult.points : []).filter((point) => {
      const startMs = Math.floor(Number(point?.startTimeNanos || 0) / 1000000);
      const endMs = Math.floor(Number(point?.endTimeNanos || 0) / 1000000);
      return pointOverlapsRunSessions(startMs, endMs, runSessions);
    });
    const speedPoints = (Array.isArray(speedResult?.points) ? speedResult.points : [])
      .map((point) => ({
        startMs: Math.floor(Number(point?.startTimeNanos || 0) / 1000000),
        speedMs: Number(point?.value?.[0]?.fpVal || 0)
      }))
      .filter((point) => Number.isFinite(point.startMs) && point.startMs > 0 && point.speedMs >= 0)
      .sort((a, b) => a.startMs - b.startMs);

    const integrateDistanceMeters = (startMs, endMs) => {
      if (!(Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) || speedPoints.length === 0) {
        return 0;
      }

      let distanceMeters = 0;
      let idx = speedPoints.findIndex((point) => point.startMs >= startMs);
      if (idx === -1) idx = speedPoints.length - 1;

      let prevIdx = idx;
      while (prevIdx > 0 && speedPoints[prevIdx].startMs > startMs) prevIdx -= 1;
      let cursor = startMs;
      let currentSpeed = speedPoints[prevIdx]?.speedMs || 0;

      for (let i = prevIdx + 1; i < speedPoints.length && cursor < endMs; i++) {
        const nextTs = speedPoints[i].startMs;
        const intervalEnd = Math.min(nextTs, endMs);
        if (intervalEnd > cursor) {
          distanceMeters += currentSpeed * ((intervalEnd - cursor) / 1000);
          cursor = intervalEnd;
        }
        currentSpeed = speedPoints[i].speedMs || 0;
      }

      if (cursor < endMs) {
        distanceMeters += currentSpeed * ((endMs - cursor) / 1000);
      }

      return distanceMeters;
    };

    const chartData = pitchPoints.map((point) => {
      const startMs = Math.floor(Number(point?.startTimeNanos || 0) / 1000000);
      const endMs = Math.floor(Number(point?.endTimeNanos || 0) / 1000000);
      const steps = Number(point?.value?.[0]?.intVal || 0);
      const durationSeconds = endMs > startMs ? (endMs - startMs) / 1000 : 0;
      const distanceMeters = integrateDistanceMeters(startMs, endMs);
      return {
        time: Number.isFinite(startMs)
          ? new Date(startMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '00:00:00',
        endTime: Number.isFinite(endMs)
          ? new Date(endMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
          : '00:00:00',
        timestampMs: Number.isFinite(startMs) ? startMs : null,
        endTimestampMs: Number.isFinite(endMs) ? endMs : null,
        steps,
        durationSeconds,
        distanceMeters: Number(distanceMeters.toFixed(3)),
        strideCm: steps > 0 ? Number(((distanceMeters / steps) * 100).toFixed(3)) : null,
        originDataSourceId: point?.originDataSourceId || null
      };
    }).filter((point) => Number.isFinite(Number(point.strideCm)) && Number(point.strideCm) > 0);

    res.json({
      date: String(date).trim(),
      stepDataSourceId: pitchResult?.dataSourceId || null,
      speedDataSourceId: speedResult?.dataSourceId || null,
      pointCount: chartData.length,
      chartData
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tcx-minute', async (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    const requestedRunId = sanitizeTcxRunId(req.query.runId);
    if (!date) return res.status(400).json({ error: 'Date required' });

    const descriptors = await listTcxRunDescriptorsForDate(date);
    let selectedDescriptor = null;
    if (requestedRunId) {
      selectedDescriptor = descriptors.find((descriptor) => descriptor.runId === requestedRunId) || null;
      if (!selectedDescriptor) {
        return res.json({ date, runId: requestedRunId, tcxPath: null, cachePath: null, pointCount: 0, chartData: [] });
      }
    } else if (descriptors.length > 0) {
      selectedDescriptor = descriptors[0];
    }

    if (selectedDescriptor) {
      const loaded = await loadTcxMinuteRowsForDescriptor(selectedDescriptor);
      return res.json({
        date,
        runId: selectedDescriptor.runId,
        legacy: !!selectedDescriptor.legacy,
        tcxPath: loaded.tcxPath,
        cachePath: loaded.cachePath,
        pointCount: Array.isArray(loaded.rows) ? loaded.rows.length : 0,
        chartData: Array.isArray(loaded.rows) ? loaded.rows : []
      });
    }

    const cachedRows = await readTcxMinuteCache(date);
    if (Array.isArray(cachedRows) && cachedRows.length > 0) {
      return res.json({
        date,
        runId: date,
        legacy: true,
        tcxPath: null,
        cachePath: getLegacyTcxIntradayCachePath(date),
        pointCount: cachedRows.length,
        chartData: cachedRows
      });
    }

    return res.json({ date, runId: requestedRunId || null, tcxPath: null, cachePath: null, pointCount: 0, chartData: [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tcx-runs', async (req, res) => {
  try {
    const date = String(req.query.date || '').trim();
    if (!date) return res.status(400).json({ error: 'Date required' });
    const descriptors = await listTcxRunDescriptorsForDate(date);
    res.json({
      date,
      count: descriptors.length,
      runs: descriptors.map((descriptor, index) => ({
        runId: descriptor.runId,
        date: descriptor.date,
        index,
        filename: descriptor.filename || null,
        startTimeMs: descriptor.startTimeMs || null,
        startTimeLabel: descriptor.startTimeLabel || '',
        legacy: !!descriptor.legacy
      }))
    });
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

app.post('/api/daily/:date/sync-tcx', async (req, res) => {
  try {
    const date = normalizeRunDate(req.params && req.params.date);
    if (!date) return res.status(400).json({ error: 'Valid date is required (YYYY-MM-DD)' });
    const payload = await syncDailySummaryFromTcx(date);
    res.json(payload);
  } catch (err) {
    console.error('Daily TCX sync error:', err);
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
const uploadMemory = multer({ storage: multer.memoryStorage() });

app.post('/api/import-tcx', uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });

    const originalName = String(req.file.originalname || '').trim();
    if (!/\.tcx$/i.test(originalName)) {
      return res.status(400).json({ error: 'TCX file required' });
    }

    const xmlText = req.file.buffer.toString('utf8');
    const trackpoints = parseTcxTrackpoints(xmlText);
    if (!Array.isArray(trackpoints) || trackpoints.length === 0) {
      return res.status(422).json({ error: 'No TCX trackpoints found' });
    }

    const runStamp =
      extractRunStampFromTcxFilename(originalName) ||
      extractRunStampFromTcxXml(xmlText);
    const resolvedDate =
      runStamp?.dateString ||
      normalizeRunDate(req.body && req.body.date);
    if (!resolvedDate) {
      return res.status(422).json({ error: 'Run date could not be determined from TCX' });
    }
    const resolvedRunId = runStamp?.runId || buildTcxRunId(resolvedDate, '000000');

    const minuteRows = buildTcxMinuteChartData(trackpoints);
    if (!Array.isArray(minuteRows) || minuteRows.length === 0) {
      return res.status(422).json({ error: 'No minute data could be built from TCX' });
    }

    const cachePath = await writeTcxMinuteRunCache(resolvedRunId, minuteRows);
    const computed = await computeDailySummaryFromTcx(resolvedDate);
    const persisted = await persistComputedTcxSummary(resolvedDate, computed);

    res.json({
      success: true,
      data: {
        imported: true,
        source: 'tcx-upload',
        date: resolvedDate,
        run_id: resolvedRunId,
        original_filename: originalName,
        cache_path: cachePath,
        pointCount: minuteRows.length,
        summary: persisted.summary || null
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

      const summaryStepCount = pickPositive(cacheMetrics.step_count, existingSummary && existingSummary.step_count);
      const summaryTotalDistanceKm = pickPositive(cacheMetrics.total_distance_km, existingSummary && existingSummary.total_distance_km);
      const summaryTotalTime = pickText(cacheMetrics.total_time, existingSummary && existingSummary.total_time);
      const summaryCaloriesKcal = pickPositive(cacheMetrics.calories_kcal, existingSummary && existingSummary.calories_kcal);

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

      const safeMaxStride = pickPositive(
        cacheMetrics.max_stride_cm,
        pickPositive(fitMetrics.max_stride_cm, existingSummary && existingSummary.max_stride)
      );

      const safeAvgStride = pickPositive(
        cacheMetrics.avg_stride_cm,
        pickPositive(fitMetrics.avg_stride_cm, existingSummary && existingSummary.avg_stride)
      );

      const safeMaxHR = pickPositive(
        fitMetrics.max_heart_rate,
        pickPositive(cacheMetrics.max_heart_rate, existingSummary && existingSummary.hr_max)
      );

      const safeAvgHR = pickPositive(
        fitMetrics.avg_heart_rate,
        pickPositive(cacheMetrics.avg_heart_rate, existingSummary && existingSummary.hr_avg)
      );

      // --- CADENCE / PITCH ---
      // Screenshots are reference-only for metrics. Cadence resolves from cache/Fit JSON.
      const cadenceFromSummary = (() => {
        const sec = parseHmsToSeconds(summaryTotalTime);
        if (!(summaryStepCount > 0) || !(sec > 0)) return 0;
        return Math.round(summaryStepCount / (sec / 60));
      })();

      let finalAvgCadence = pickPositive(
        cacheMetrics.avg_cadence,
        pickPositive(
          fitMetrics.avg_cadence,
          pickPositive(cadenceFromSummary, existingSummary && existingSummary.avg_cadence)
        )
      );

      let finalMaxCadence = pickPositive(
        cacheMetrics.max_cadence,
        pickPositive(
          fitMetrics.max_cadence,
          existingSummary && existingSummary.max_cadence
        )
      );
      if (finalMaxCadence <= 0 && finalAvgCadence > 0) finalMaxCadence = finalAvgCadence;
      if (finalMaxCadence > 0 && finalAvgCadence > 0 && finalMaxCadence < finalAvgCadence) finalMaxCadence = finalAvgCadence;

      // --- SPEED CALCULATION ---
      // Screenshots are reference-only for metrics. Avg Speed resolves from cache/Fit JSON.
      const derivedSpeed = await computeDerivedFromIntradayCache(result.date);
      let finalAvgSpeed = pickPositive(
        cacheMetrics.avg_speed,
        pickPositive((derivedSpeed && derivedSpeed.json_avg_speed) || 0, existingSummary && existingSummary.avg_speed)
      );
      if (finalAvgSpeed === 0 && summaryTotalDistanceKm > 0 && summaryTotalTime) {
        const parts = String(summaryTotalTime).split(':').map(Number);
        let hours = 0;
        if (parts.length === 3) hours = parts[0] + parts[1] / 60 + parts[2] / 3600;
        else if (parts.length === 2) hours = parts[0] / 60 + parts[1] / 3600;

        if (hours > 0) finalAvgSpeed = parseFloat((summaryTotalDistanceKm / hours).toFixed(1));
      }

      const finalMaxSpeed = pickPositive(
        cacheMetrics.max_speed,
        pickPositive(fitMetrics.max_speed, existingSummary && existingSummary.max_speed)
      );

      // Persist computed speeds into asset metrics (image_assets) as well.
      result.avg_speed = finalAvgSpeed;
      result.max_speed = finalMaxSpeed;

      const resolvedMaxStride = Number(safeMaxStride > 0 ? safeMaxStride.toFixed(1) : '0');
      const resolvedMaxHR = Math.round(safeMaxHR || 0);
      const resolvedAvgHR = Math.round(safeAvgHR || 0);
      const resolvedMaxCadence = Math.round(finalMaxCadence || 0);
      const resolvedAvgCadence = Math.round(finalAvgCadence || 0);
      const resolvedMaxSpeed = Number(finalMaxSpeed > 0 ? finalMaxSpeed.toFixed(1) : '0');
      const resolvedAvgSpeed = Number(finalAvgSpeed > 0 ? finalAvgSpeed.toFixed(1) : '0');
      const resolvedStepCount = Math.round(summaryStepCount || 0);
      const resolvedTotalDistanceKm = Number(summaryTotalDistanceKm > 0 ? summaryTotalDistanceKm.toFixed(2) : '0');
      const resolvedTotalTime = summaryTotalTime || null;
      const resolvedAvgStride = calculateAverageStrideCm(resolvedTotalDistanceKm, resolvedStepCount)
        || Number(safeAvgStride > 0 ? safeAvgStride.toFixed(1) : '0');

      await repo.saveDailySummary({
        date: result.date,
        step_count: resolvedStepCount,
        total_distance_km: resolvedTotalDistanceKm,
        total_time: resolvedTotalTime,
        calories_kcal: summaryCaloriesKcal,
        max_stride: resolvedMaxStride,
        avg_stride: resolvedAvgStride,
        hr_max: resolvedMaxHR,
        hr_avg: resolvedAvgHR,
        avg_cadence: resolvedAvgCadence,
        max_cadence: resolvedMaxCadence,
        avg_speed: resolvedAvgSpeed,
        max_speed: resolvedMaxSpeed,
        message: (existingSummary ? existingSummary.message : '') // Preserve existing message too
      });

      // 笘・Generate Advice (Async update)
      if (!skipAdvice) {
        try {
        

        // 笘・FIX: Pass Safe Metrics (from Google Fit) to AI, NOT raw OCR result which might be 0
        const advice = await geminiService.generateAdvice({
          date: result.date,
          step_count: resolvedStepCount,
          total_distance_km: resolvedTotalDistanceKm,
          calories_kcal: summaryCaloriesKcal,
          avg_stride_cm: resolvedAvgStride,
          max_stride_cm: resolvedMaxStride,
          avg_heart_rate: resolvedAvgHR,
          max_heart_rate: resolvedMaxHR,
          avg_cadence: resolvedAvgCadence,
          max_cadence: resolvedMaxCadence,
          avg_speed: resolvedAvgSpeed,
          max_speed: resolvedMaxSpeed
        }, [req.file.path]);

        const adviceToSave = (advice === GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE &&
          existingSummary &&
          String(existingSummary.message || '').trim().length > 0 &&
          String(existingSummary.message || '').trim() !== GEMINI_TEMPORARY_UNAVAILABLE_MESSAGE)
          ? existingSummary.message
          : advice;

        await repo.saveDailySummary({
          date: result.date,
          step_count: resolvedStepCount,
          total_distance_km: resolvedTotalDistanceKm,
          total_time: resolvedTotalTime,
          calories_kcal: summaryCaloriesKcal,
          max_stride: resolvedMaxStride,
          avg_stride: resolvedAvgStride,
          hr_max: resolvedMaxHR,
          hr_avg: resolvedAvgHR,
          avg_cadence: resolvedAvgCadence,
          max_cadence: resolvedMaxCadence,
          avg_speed: resolvedAvgSpeed,
          max_speed: resolvedMaxSpeed,
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

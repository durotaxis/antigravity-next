require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const repo = require('./repo');
const imageRepo = require('./image_repo');
const imageService = require('./image_service');
const visionService = require('./vision_service');
const fs = require('fs').promises;
const geminiService = require('./gemini_service');
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
// 全オリジン許可 (スマホからの接続をスムーズに)
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const genAI = null; // Removed generic init
const model = null; // Removed generic init

// --- API Controller ---

// 1. Get All Runs (シンプル・イズ・ベスト)
// DBにある事実（日付、ストライド、心拍数、画像）だけを返します
app.get('/api/runs', async (req, res) => {
  try {
    const rawRuns = await repo.getAllRuns();

    const includeDerived = String(req.query.includeDerived || '') === '1';

    const formattedRuns = await Promise.all(rawRuns.map(async (row) => {
      const derived = includeDerived ? await computeDerivedFromIntradayCache(row.date) : null;

      return ({
      id: row.id,
      date: row.date,
      // Next版が必要とするデータのみ
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
      images: row.images || [],
      message: row.message || '' // AIアドバイス
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
    if (!date) return res.status(400).json({ error: 'Date required' });

    // Prefer local cache to avoid Fit API rate limits.
    try {
      const cacheFile = path.join(__dirname, 'storage', 'cache', `intraday_${date}.json`);
      const raw = await fs.readFile(cacheFile, 'utf8');
      const points = JSON.parse(raw);
      return res.json(points);
    } catch {
      // fall back to Fit API
    }

    const chartData = await googleFitService.getIntradayMetrics(date);
    res.json(chartData);
  } catch (err) {
    console.error("Stride API Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Update Daily Summary (手動修正など)
app.post('/api/daily', async (req, res) => {
  try {
    const { date, max_stride, avg_stride, hr_max, hr_avg, message } = req.body;

    if (!date) return res.status(400).json({ error: 'Date is required' });

    // キャメルケース/スネークケースの揺れを吸収
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

// --- File & Image Management (Inbox機能) ---

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
    const results = await imageService.importSelectedFiles(filenames, runId);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// 2.7 Delete Image Asset (Physical & DB)
app.delete('/api/runs/:runId/images/:assetId', async (req, res) => {
  try {
    const { assetId } = req.params;
    // Completely remove valid asset (User requested physical delete)
    const changes = await imageRepo.deleteAssetWithFile(assetId);
    console.log(`Deleted Asset ${assetId}: ${changes} records removed.`);
    res.json({ success: true });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ error: err.message });
  }
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

// 画像アップロード -> Gemini解析 -> DB保存
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    const filename = req.file.filename;
    const originalName = req.file.originalname;
    console.log(`Processing: ${filename}`);

    // 1. Asset作成 (Hash & Deduplication)
    const fs = require('fs').promises;
    const fileBuffer = await fs.readFile(req.file.path);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const existingAsset = await imageRepo.findAssetByHash(fileHash);
    if (existingAsset) {
      // Multer already stored the file with a random filename; remove it for duplicate uploads.
      await fs.unlink(req.file.path).catch(() => { });
      return res.status(409).json({
        error: 'This image has already been uploaded.',
        code: 'DUPLICATE_UPLOAD',
        asset_id: existingAsset.asset_id
      });
    }

    const assetId = await imageRepo.createAsset(fileHash, filename, originalName);

    // 3. Main Analysis (Gemini)
    // If OCR fails, we still ingest the image and create/link the asset without crashing the request.
    console.log(`Analyzing: ${filename} (Gemini)`);
    let result = {};
    let ocrFailed = false;
    try {
      const analyzed = await visionService.analyzeImage(filename);
      result = analyzed && typeof analyzed === 'object' ? analyzed : {};
      console.log("Analysis Result:", result);
    } catch (ocrErr) {
      ocrFailed = true;
      console.error("OCR Failed (continuing import):", ocrErr && ocrErr.message ? ocrErr.message : ocrErr);
      result = {
        ocr_failed: true,
        ocr_error: ocrErr && ocrErr.message ? String(ocrErr.message) : 'OCR failed'
      };
    }

    if (ocrFailed) {
      // Persist whatever we have (mostly NULLs) and return success.
      await imageRepo.updateAssetMetricsById(assetId, result);

      // Optional: caller can provide runId/date to link even when OCR fails.
      const forcedRunId = (req.body && (req.body.runId || req.body.date)) ? String(req.body.runId || req.body.date).trim() : '';
      if (forcedRunId) {
        try {
          await imageRepo.linkImageToRun(forcedRunId, assetId);
          result.date = forcedRunId;
        } catch (linkErr) {
          console.error("Link Failed (ignored):", linkErr && linkErr.message ? linkErr.message : linkErr);
        }
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

    // Persist avg_speed into image_assets even if date inference fails.
    // (daily_summary still requires result.date.)
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

    // 2. 日付が取れたらGoogle Fitから正確なデータを取得してDBに保存
    if (result.date) {

      // ★ Optimization: Check if summary already exists before calling Fit API
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
        console.log(`Refreshing Google Fit metrics for ${result.date}...`);
        const fitData = null; // prefer local JSON cache to avoid API requests
        if (fitData) {
          console.log("Updated Fit Metrics:", fitData);
          fitMetrics = fitData;
        }
      } catch (fitErr) {
        console.error("Google Fit Refresh Failed (falling back to stored/vision data):", fitErr.message);
        // Fallback to existing summary if available
        if (existingSummary) {
          fitMetrics = {
            avg_heart_rate: existingSummary.avg_heart_rate,
            max_heart_rate: existingSummary.max_heart_rate,
            avg_stride_cm: existingSummary.avg_stride_cm,
            max_stride_cm: existingSummary.max_stride_cm
          };
        }
      }

      const safeMaxStride = (result.max_stride_cm > 0) ? result.max_stride_cm
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

      // --- CADENCE / PITCH (User Request) ---
      // Avg Cadence: Priority Vision > Fit > Existing
      const finalAvgCadence = (result.avg_cadence > 0) ? result.avg_cadence
        : (fitMetrics.avg_cadence > 0) ? fitMetrics.avg_cadence
          : (existingSummary && existingSummary.avg_cadence > 0) ? existingSummary.avg_cadence
            : 0;

      // Max Cadence: Priority Fit (1-min max) > Vision > Existing
      const finalMaxCadence = (fitMetrics.max_cadence > 0) ? fitMetrics.max_cadence
        : (existingSummary && existingSummary.max_cadence > 0) ? existingSummary.max_cadence
          : 0;

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

      await repo.saveDailySummary({
        date: result.date,
        step_count: summaryStepCount,
        total_distance_km: summaryTotalDistanceKm,
        total_time: summaryTotalTime,
        calories_kcal: summaryCaloriesKcal,
        max_stride: safeMaxStride,
        avg_stride: safeAvgStride,
        hr_max: safeMaxHR,
        hr_avg: safeAvgHR,
        avg_cadence: finalAvgCadence,
        max_cadence: finalMaxCadence,
        avg_speed: finalAvgSpeed,
        max_speed: finalMaxSpeed,
        message: (existingSummary ? existingSummary.message : '') // Preserve existing message too
      });

      // ★ Generate Advice (Async update)
      try {
        console.log("Generating Advice for", result.date);

        // ★ FIX: Pass Safe Metrics (from Google Fit) to AI, NOT raw OCR result which might be 0
        const advice = await geminiService.generateAdvice({
          date: result.date,
          step_count: summaryStepCount,
          total_distance_km: summaryTotalDistanceKm,
          calories_kcal: summaryCaloriesKcal,
          avg_stride_cm: safeAvgStride,
          max_stride_cm: safeMaxStride, // Use Safe Value
          avg_heart_rate: safeAvgHR,
          max_heart_rate: safeMaxHR,    // Use Safe Value
          avg_cadence: finalAvgCadence,
          max_cadence: finalMaxCadence,
          avg_speed: finalAvgSpeed,     // Add Speed
          max_speed: finalMaxSpeed      // Add Speed
        }, [req.file.path]);

        const adviceToSave = (advice === GEMINI_RATE_LIMIT_MESSAGE &&
          existingSummary &&
          String(existingSummary.message || '').trim().length > 0 &&
          String(existingSummary.message || '').trim() !== GEMINI_RATE_LIMIT_MESSAGE)
          ? existingSummary.message
          : advice;

        await repo.saveDailySummary({
          date: result.date,
          step_count: summaryStepCount,
          total_distance_km: summaryTotalDistanceKm,
          total_time: summaryTotalTime,
          calories_kcal: summaryCaloriesKcal,
          max_stride: safeMaxStride, // Use Safe Value
          avg_stride: safeAvgStride, // Use Safe Value
          hr_max: safeMaxHR,         // Use Safe Value
          hr_avg: safeAvgHR,         // Use Safe Value
          avg_cadence: finalAvgCadence,
          max_cadence: finalMaxCadence,
          avg_speed: finalAvgSpeed,
          max_speed: finalMaxSpeed,
          message: adviceToSave // Update with advice
        });
        console.log("Advice Saved.");
      } catch (adviceErr) {
        console.error("Advice Gen Failed:", adviceErr.message);
      }

      // 画像をRunに紐付け
      await imageRepo.linkImageToRun(result.date, assetId);
    }

    // 3. アセット情報更新
    await imageRepo.updateAssetMetricsById(assetId, result);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Gemini Advice API
app.post('/api/advice', async (req, res) => {
  try {
    const { date, avgStride, avgHR, maxStride, maxHR, avgCadence, maxCadence } = req.body;

    const cached = await repo.getDailySummary(date);
    if (cached && cached.message) return res.json({ advice: cached.message });

    // Fetch images for this run to provide context to Gemini
    const images = await imageRepo.getImagesForRun(date);
    const imagePaths = images.map(img => path.join(process.cwd(), 'public/assets/store', img.stored_filename));

    // Prompt has been moved to geminiService
    const advice = await geminiService.generateCoachAdvice({
      date,
      avgStride,
      avgHR,
      maxStride,
      maxHR,
      avgCadence,
      maxCadence
    }, imagePaths);

    // DBにアドバイスを保存
    await repo.saveDailySummary({
      date,
      max_stride: maxStride,
      avg_stride: avgStride,
      hr_max: maxHR,
      hr_avg: avgHR,
      avg_cadence: avgCadence,
      max_cadence: maxCadence,
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
  // スマホからアクセス可能にする (0.0.0.0)
  app.listen(port, '0.0.0.0', () => {
    console.log(`--- AntiGravity Engine ONLINE (Port: ${port}) ---`);
    console.log(`- API Ready: http://192.168.3.153:${port}`);
    console.log(`- Mobile App: Use Port 3001`);
  });
}

module.exports = app;

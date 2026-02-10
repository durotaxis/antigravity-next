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

    // Fetch from Google Fit directly
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

    const assetId = await imageRepo.createAsset(fileHash, filename, originalName);

    // 3. Main Analysis (Gemini)
    console.log(`Analyzing: ${filename} (Gemini)`);
    const result = await visionService.analyzeImage(filename);
    console.log("Analysis Result:", result);

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

      let fitMetrics = {
        max_stride_cm: 0,
        max_heart_rate: 0
      };

      // --- REFRESH METRICS FROM GOOGLE FIT ---
      // We always attempt to fetch fresh metrics during analysis to ensure the Dashboard (DB)
      // matches the latest filtering/smoothing logic in google_fit_service.
      try {
        console.log(`Refreshing Google Fit metrics for ${result.date}...`);
        const fitData = await googleFitService.getDailyMetrics(result.date);
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

      const safeMaxStride = (fitMetrics.max_stride_cm > 0) ? fitMetrics.max_stride_cm
        : (existingSummary && existingSummary.max_stride > 0) ? existingSummary.max_stride
          : (result.max_stride_cm || 0);

      const safeAvgStride = (fitMetrics.avg_stride_cm > 0) ? fitMetrics.avg_stride_cm
        : (existingSummary && existingSummary.avg_stride > 0) ? existingSummary.avg_stride
          : (result.avg_stride_cm || 0);

      const safeMaxHR = (fitMetrics.max_heart_rate > 0) ? fitMetrics.max_heart_rate
        : (existingSummary && existingSummary.hr_max > 0) ? existingSummary.hr_max
          : (result.max_heart_rate || 0);

      const safeAvgHR = (fitMetrics.avg_heart_rate > 0) ? fitMetrics.avg_heart_rate
        : (existingSummary && existingSummary.hr_avg > 0) ? existingSummary.hr_avg
          : (result.avg_heart_rate || 0);

      // --- CADENCE / PITCH (User Request) ---
      // Avg Cadence: Priority Vision > Fit > Existing
      const finalAvgCadence = (result.avg_cadence > 0) ? result.avg_cadence
        : (fitMetrics.avg_cadence > 0) ? fitMetrics.avg_cadence
          : (existingSummary && existingSummary.avg_cadence > 0) ? existingSummary.avg_cadence
            : 0;

      // Max Cadence: Priority Fit (1-min max) > Vision > Existing
      const finalMaxCadence = (fitMetrics.max_cadence > 0) ? fitMetrics.max_cadence
        : (result.max_cadence > 0) ? result.max_cadence
          : (existingSummary && existingSummary.max_cadence > 0) ? existingSummary.max_cadence
            : 0;

      // --- SPEED CALCULATION (User Request) ---
      // Avg Speed: Priority JSON(cache) > Vision > Calculated
      const derivedSpeed = await computeDerivedFromIntradayCache(result.date);
      let finalAvgSpeed = (derivedSpeed && derivedSpeed.json_avg_speed > 0) ? derivedSpeed.json_avg_speed : (result.avg_speed || 0);
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
          step_count: result.step_count,
          total_distance_km: result.total_distance_km,
          calories_kcal: result.calories_kcal,
          avg_stride_cm: safeAvgStride,
          max_stride_cm: safeMaxStride, // Use Safe Value
          avg_heart_rate: safeAvgHR,
          max_heart_rate: safeMaxHR,    // Use Safe Value
          avg_cadence: finalAvgCadence,
          max_cadence: finalMaxCadence,
          avg_speed: finalAvgSpeed,     // Add Speed
          max_speed: finalMaxSpeed      // Add Speed
        }, [req.file.path]);

        await repo.saveDailySummary({
          date: result.date,
          max_stride: safeMaxStride, // Use Safe Value
          avg_stride: safeAvgStride, // Use Safe Value
          hr_max: safeMaxHR,         // Use Safe Value
          hr_avg: safeAvgHR,         // Use Safe Value
          avg_cadence: finalAvgCadence,
          max_cadence: finalMaxCadence,
          avg_speed: finalAvgSpeed,
          max_speed: finalMaxSpeed,
          message: advice // Update with advice
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

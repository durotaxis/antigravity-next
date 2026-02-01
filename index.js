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

    const formattedRuns = rawRuns.map(row => ({
      id: row.id,
      date: row.date,
      // Next版が必要とするデータのみ
      avg_stride: row.avg_stride ?? 0,
      avg_heart_rate: row.hr_avg ?? 0,
      max_stride: row.max_stride ?? 0,
      max_heart_rate: row.hr_max ?? 0,
      images: row.images || [],
      message: row.message || '' // AIアドバイス
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

app.delete('/api/runs/:runId/images/:assetId', async (req, res) => {
  try {
    const { runId, assetId } = req.params;
    await imageRepo.unlinkImageFromRun(runId, assetId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2.7 Delete Image Link
app.delete('/api/runs/:runId/images/:assetId', async (req, res) => {
  try {
    const { runId, assetId } = req.params;
    const changes = await imageRepo.unlinkImageFromRun(runId, assetId);
    if (changes > 0) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Link not found' });
    }
  } catch (err) {
    console.error(err);
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

    // 2. Optimization: Check if date exists in filename and summary exists in DB
    const dateFromFilename = imageService.extractDateFromFilename(originalName);
    console.log(`[DEBUG] Original Filename: ${originalName}`);
    console.log(`[DEBUG] Extracted Date: ${dateFromFilename}`);

    if (dateFromFilename) {
      const existingSummary = await repo.getDailySummary(dateFromFilename);
      if (existingSummary) {
        console.log(`[Optimization] Summary exists for ${dateFromFilename}. Skipping Gemini Analysis.`);
        // Link image to run
        await imageRepo.linkImageToRun(dateFromFilename, assetId);
        // Return success with existing data
        return res.json({
          ...existingSummary,
          skippedAnalysis: true,
          message: 'Linked to existing run'
        });
      }
    }

    // 3. Main Analysis (Gemini)
    console.log(`Analyzing: ${filename} (Gemini)`);
    const result = await visionService.analyzeImage(filename);
    console.log("Analysis Result:", result);

    // 2. 日付が取れたらDBに保存 (Runの自動作成)
    if (result.date) {
      await repo.saveDailySummary({
        date: result.date,
        max_stride: result.max_stride_cm || 0,
        avg_stride: result.avg_stride_cm || 0,
        hr_max: result.max_heart_rate || 0,
        hr_avg: result.avg_heart_rate || 0,
        message: ''
      });

      // ★ Generate Advice (Async update)
      try {
        console.log("Generating Advice for", result.date);
        const advice = await geminiService.generateAdvice({
          date: result.date,
          step_count: result.step_count,
          total_distance_km: result.total_distance_km,
          calories_kcal: result.calories_kcal,
          avg_stride_cm: result.avg_stride_cm || 0,
          avg_heart_rate: result.avg_heart_rate || 0
        });

        await repo.saveDailySummary({
          date: result.date,
          max_stride: result.max_stride_cm || 0,
          avg_stride: result.avg_stride_cm || 0,
          hr_max: result.max_heart_rate || 0,
          hr_avg: result.avg_heart_rate || 0,
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
    await imageRepo.updateAssetMetrics(filename, result);

    res.json({ success: true, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Gemini Advice API
app.post('/api/advice', async (req, res) => {
  try {
    const { date, avgStride, avgHR, maxStride, maxHR } = req.body;

    const cached = await repo.getDailySummary(date);
    if (cached && cached.message) return res.json({ advice: cached.message });

    // Prompt has been moved to geminiService
    const advice = await geminiService.generateCoachAdvice({
      date,
      avgStride,
      avgHR,
      maxStride,
      maxHR
    });

    // DBにアドバイスを保存
    await repo.saveDailySummary({
      date,
      max_stride: maxStride,
      avg_stride: avgStride,
      hr_max: maxHR,
      hr_avg: avgHR,
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
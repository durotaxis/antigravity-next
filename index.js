require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const repo = require('./repo');
const imageRepo = require('./image_repo');
const imageService = require('./image_service');
const visionService = require('./vision_service');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const fs = require('fs').promises;

const app = express();
const port = 3000;

// --- Security & Config ---

// 開発中は全オリジン許可 (CORSエラー回避)
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

// --- Initialize Gemini ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');


// --- API Controller ---

// Get all runs (Adapter Layer)
app.get('/api/runs', async (req, res) => {
  try {
    const rawRuns = await repo.getAllRuns();

    const formattedRuns = rawRuns.map(row => ({
      id: row.id,
      date: row.date,

      avg_stride: row.avg_stride ?? 0,
      avg_heart_rate: row.hr_avg ?? 0,

      // UI dummy data
      distance: 0,
      time: '--:--',
      steps: 0,

      // Link real images
      images: row.images || []
    }));

    res.json(formattedRuns);
  } catch (err) {
    console.error("Repo Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Delete Run
app.delete('/api/runs/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const changes = await repo.deleteRun(id);

    if (changes === 0) {
      return res.status(404).json({ error: 'Run not found' });
    }

    console.log(`Deleted run ID: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// List files in Inbox
app.get('/api/inbox/files', async (req, res) => {
  try {
    const files = await imageService.getInboxFiles();
    res.json(files);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Preview Inbox File
app.get('/api/inbox/preview/:filename', (req, res) => {
  const { filename } = req.params;
  // Basic path traversal protection
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return res.status(400).send('Invalid filename');
  }
  const filepath = path.join(imageService.INBOX_DIR, filename);
  res.sendFile(filepath);
});

// Import selected
app.post('/api/runs/:runId/import-selected', async (req, res) => {
  try {
    const { runId } = req.params;
    const { filenames } = req.body;

    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'No filenames provided' });
    }

    const results = await imageService.importSelectedFiles(filenames, runId);
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Unlink image
app.delete('/api/runs/:runId/images/:assetId', async (req, res) => {
  try {
    const { runId, assetId } = req.params;
    const changes = await imageRepo.unlinkImageFromRun(runId, assetId);
    if (changes === 0) {
      return res.status(404).json({ error: 'Image link not found' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Multer setup for file uploads
const multer = require('multer');
const crypto = require('crypto');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'public/assets/store/')
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const hash = crypto.createHash('sha256').update(file.originalname + Date.now()).digest('hex').substring(0, 12);
    cb(null, `upload_${hash}${ext}`);
  }
});

const upload = multer({ storage: storage });

// Vision Analysis Endpoint (Upload + Analyze)
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const filename = req.file.filename;
    console.log(`Processing uploaded file: ${filename}`);

    // 1. Analyze with Gemini
    const result = await visionService.analyzeImage(filename);
    console.log("Analysis Result:", result);

    // 2. Map to DB Schema
    const dbData = {
      date: result.date,
      max_stride: result.max_stride_cm || 0,
      avg_stride: result.avg_stride_cm || 0,
      hr_avg: result.avg_heart_rate || 0,
      hr_max: result.max_heart_rate || 0,
      message: '' // Advice will be generated later
    };

    // 3. Save to Daily Summary DB
    if (dbData.date) {
      await repo.saveDailySummary(dbData);
    } else {
      console.warn("Date not found in analysis, skipping DB daily_summary save");
    }

    // 4. Link Image to Run
    // Need to find run_id (which is the date)
    if (dbData.date) {
      // Create asset record
      const assetId = await imageRepo.registerAsset(filename, req.file.originalname);
      // Link to run
      await imageRepo.linkImageToRun(dbData.date, assetId);
    }

    // 5. Update Asset Metrics (redundant but checks out)
    await imageRepo.updateAssetMetrics(filename, result);

    res.json({ success: true, data: result });

  } catch (err) {
    console.error('Analysis API Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Vision Analysis (Existing - Direct Filename)
app.post('/api/analyze-vision', async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Filename required' });
    }

    console.log(`Analyzing vision for: ${filename}`);
    const result = await visionService.analyzeImage(filename);

    console.log(`Saving analysis to asset: ${filename}`);
    await imageRepo.updateAssetMetrics(filename, result);

    res.json({ success: true, data: result });

  } catch (err) {
    console.error('Vision API Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper for Google Auth
async function getAuthenticatedClient() {
  const credentialsContent = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(credentialsContent);
  const key = keys.installed || keys.web;
  const auth = new google.auth.OAuth2(key.client_id, key.client_secret, key.redirect_uris[0]);

  try {
    const tokenContent = await fs.readFile(TOKEN_PATH);
    auth.setCredentials(JSON.parse(tokenContent));
    return auth;
  } catch (err) {
    const client = await authenticate({
      keyfilePath: CREDENTIALS_PATH,
      scopes: [
        'https://www.googleapis.com/auth/fitness.activity.read',
        'https://www.googleapis.com/auth/fitness.location.read',
        'https://www.googleapis.com/auth/fitness.body.read',
        'https://www.googleapis.com/auth/fitness.heart_rate.read'
      ],
      authOptions: { access_type: 'offline', prompt: 'consent' }
    });
    await fs.writeFile(TOKEN_PATH, JSON.stringify(client.credentials));
    return client;
  }
}

// Stride API
app.get('/api/stride', async (req, res) => {
  try {
    const inputDate = req.query.date || new Date().toISOString().split('T')[0];
    const auth = await getAuthenticatedClient();
    const fitness = google.fitness({ version: 'v1', auth });

    const start = new Date(`${inputDate}T00:00:00`);
    const end = new Date(`${inputDate}T23:59:59`);

    const fitnessRes = await fitness.users.dataset.aggregate({
      userId: 'me',
      requestBody: {
        aggregateBy: [
          { dataSourceId: "derived:com.google.step_count.delta:com.google.android.gms:estimated_steps" },
          { dataSourceId: "derived:com.google.distance.delta:com.google.android.gms:pruned_distance" },
          { dataTypeName: "com.google.heart_rate.bpm" }
        ],
        bucketByTime: { durationMillis: 60000 },
        startTimeMillis: start.getTime(),
        endTimeMillis: end.getTime(),
      },
    });

    const data = fitnessRes.data.bucket.map(bucket => {
      const steps = bucket.dataset[0].point[0]?.value[0]?.intVal || 0;
      const distance = bucket.dataset[1].point[0]?.value[0]?.fpVal || 0;
      const heartRate = bucket.dataset[2].point[0]?.value[0]?.fpVal || 0;

      return {
        time: new Date(parseInt(bucket.startTimeMillis)).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
        steps,
        distance,
        heartRate,
        stride: steps > 30 ? (distance / steps) * 100 : 0
      };
    }).filter(d => d.steps > 30);

    res.json(data);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Advice API
app.post('/api/advice', async (req, res) => {
  try {
    const { date, maxStride, avgStride, maxHR, avgHR } = req.body;

    const cachedData = await repo.getDailySummary(date);
    if (cachedData && cachedData.message) {
      console.log('✅ Found in DB');
      return res.json({ advice: cachedData.message });
    }

    console.log('🤖 Not in DB, calling Gemini...');

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: "Server missing GEMINI_API_KEY" });
    }

    const prompt = `
      You are a biomechanics expert and elite running coach.
      Analyze the following running data for date: ${date}:
      
      - Max Stride: ${maxStride} cm
      - Avg Stride: ${avgStride} cm
      - Max Heart Rate: ${maxHR} bpm
      - Avg Heart Rate: ${avgHR} bpm
      
      Provide concise, actionable advice (under 100 characters in Japanese) to improve performance, 
      focusing on the relationship between stride length and cardiovascular efficiency.
      Do not state the obvious. Be insightful.
    `;

    const callGemini = async () => {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    };

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini API Timeout')), 15000)
    );

    const advice = await Promise.race([callGemini(), timeoutPromise]);

    await repo.saveDailySummary({
      date,
      max_stride: maxStride || 0,
      avg_stride: avgStride || 0,
      hr_max: maxHR || 0,
      hr_avg: avgHR || 0,
      message: advice
    });
    console.log('💾 Saved to DB');

    res.json({ advice });

  } catch (error) {
    console.error("Gemini/DB Error:", error);
    const msg = error.message || '';
    if (msg.includes('Timeout')) return res.status(504).json({ error: "Timeout" });
    res.status(500).json({ error: `AI Error: ${msg}` });
  }
});

// Update Daily Summary
app.post('/api/daily', async (req, res) => {
  try {
    const { date, maxStride, avgStride, maxHR, avgHR, message,
      max_stride, avg_stride, hr_max, hr_avg } = req.body;

    if (!date) {
      return res.status(400).json({ error: 'Date is required' });
    }

    const data = {
      date,
      max_stride: max_stride ?? maxStride,
      avg_stride: avg_stride ?? avgStride,
      hr_max: hr_max ?? maxHR,
      hr_avg: hr_avg ?? avgHR,
      message: message ?? ''
    };

    await repo.saveDailySummary(data);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Static files
app.use(express.static(path.join(process.cwd(), 'public')));

if (require.main === module) {
  app.listen(port, () => console.log(`--- CONTROL TOWER ONLINE (Port: ${port}) ---`));
}

module.exports = app;
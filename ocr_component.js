const pythonOcrService = require('./vision_service');
const geminiVisionOcrService = require('./gemini_vision_ocr_service');
const path = require('path');
const fs = require('fs').promises;

const STORE_DIR = path.join(__dirname, 'public/assets/store');

function normalizeStoredFilename(value) {
  return String(value || '').trim().toLowerCase();
}

function toBool(value, defaultValue = false) {
  if (value === undefined || value === null) return defaultValue;
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'yes' || text === 'on') return true;
  if (text === '0' || text === 'false' || text === 'no' || text === 'off') return false;
  return defaultValue;
}

function formatDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function buildMockOcrResult(item = {}, index = 0) {
  return {
    // Concept separation: mock data must not decide run date.
    // Persist layer will reject MISSING_RUN_DATE for mock rows.
    date: null,
    step_count: Number(item.step_count || 10234),
    total_distance_km: Number(item.total_distance_km || 8.4),
    total_time: String(item.total_time || '00:48:00'),
    avg_heart_rate: Number(item.avg_heart_rate || 148),
    max_heart_rate: Number(item.max_heart_rate || 171),
    avg_speed: Number(item.avg_speed || 10.5),
    max_speed: Number(item.max_speed || 13.2),
    avg_stride_cm: Number(item.avg_stride_cm || 82.4),
    max_stride_cm: Number(item.max_stride_cm || 108.7),
    avg_cadence: Number(item.avg_cadence || 176),
    max_cadence: Number(item.max_cadence || 191),
    mock: true
  };
}

async function analyzeScreenOcr(filename, mode = 'python') {
  const selectedMode = String(mode || 'python').toLowerCase().trim();
  if (selectedMode === 'vision') {
    return geminiVisionOcrService.analyzeImage(filename);
  }
  return pythonOcrService.analyzeImage(filename);
}

function pickItemMode(item = {}, job = {}) {
  const raw = String(item.mode || '').toLowerCase().trim();
  if (raw === 'vision' || raw === 'python' || raw === 'mock') return raw;

  if (toBool(item.useVision, false)) return 'vision';
  if (toBool(job.use_vision_default, false)) return 'vision';
  const fromJob = String(job.ocr_mode_default || '').toLowerCase().trim();
  if (fromJob === 'vision' || fromJob === 'python') return fromJob;
  return 'python';
}

function resolveBatchConcurrency(payload = {}, job = {}) {
  const fromJob = Number(job && (job.concurrency || job.parallelism || 0));
  const fromPayload = Number(payload && (payload.concurrency || 0));
  const fromEnv = Number(process.env.BATCH_OCR_CONCURRENCY || 0);
  const raw = fromJob || fromPayload || fromEnv || 2;
  if (!Number.isFinite(raw)) return 2;
  return Math.max(1, Math.min(8, Math.floor(raw)));
}

async function resolveStoredFilenameInStore(filename) {
  const raw = String(filename || '').trim();
  if (!raw) return null;

  const full = path.join(STORE_DIR, raw);
  try {
    await fs.access(full);
    return raw;
  } catch {
    // fall through
  }

  try {
    const entries = await fs.readdir(STORE_DIR);
    const normalized = normalizeStoredFilename(raw);
    const matched = entries.find((name) => normalizeStoredFilename(name) === normalized);
    return matched || null;
  } catch {
    return null;
  }
}

async function analyzeBatchItem(item = {}, index = 0, job = {}) {
  const mode = pickItemMode(item, job);
  try {
    let data;
    const requestedFilename = item.filename ? String(item.filename).trim() : null;
    const resolvedFilename = await resolveStoredFilenameInStore(requestedFilename);
    const useOcr = (mode === 'vision' || mode === 'python') && !!resolvedFilename;

    if (useOcr && resolvedFilename) {
      data = await analyzeScreenOcr(resolvedFilename, mode);
    } else {
      data = buildMockOcrResult(item, index);
    }

    return {
      item_id: item.item_id || item.itemId || null,
      index,
      ok: true,
      mode: useOcr ? mode : 'mock',
      input: {
        filename: resolvedFilename || requestedFilename,
        runId: item.runId || item.run_id || null,
        date: item.date || null,
        requested_mode: mode,
        fallback_reason: !useOcr && (mode === 'vision' || mode === 'python') ? 'FILE_NOT_FOUND' : null
      },
      data
    };
  } catch (error) {
    return {
      item_id: item.item_id || item.itemId || null,
      index,
      ok: false,
      mode,
      input: {
        filename: item.filename || null,
        runId: item.runId || item.run_id || null,
        date: item.date || null,
        requested_mode: mode
      },
      error: error && error.message ? String(error.message) : 'Batch OCR failed'
    };
  }
}

async function analyzeBatchJob(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const job = payload.job && typeof payload.job === 'object' ? payload.job : {};
  const startedAt = new Date().toISOString();
  const results = new Array(items.length);
  const concurrency = resolveBatchConcurrency(payload, job);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      const item = items[current] || {};
      results[current] = await analyzeBatchItem(item, current, job);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);

  const success = results.filter(r => r.ok).length;
  const failed = results.length - success;
  return {
    job: {
      job_id: job.job_id || payload.job_id || `mock-${Date.now()}`,
      source: job.source || 'manual',
      concurrency,
      started_at: startedAt,
      finished_at: new Date().toISOString()
    },
    total: results.length,
    success,
    failed,
    results
  };
}

async function analyzeBatchMock(items = []) {
  return analyzeBatchJob({ job: { source: 'legacy-mock' }, items });
}

module.exports = {
  analyzeScreenOcr,
  analyzeBatchMock,
  analyzeBatchJob
};

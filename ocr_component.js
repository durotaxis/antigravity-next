const visionService = require('./vision_service');
const path = require('path');
const fs = require('fs').promises;

const STORE_DIR = path.join(__dirname, 'public/assets/store');

function normalizeStoredFilename(value) {
  return String(value || '').trim().toLowerCase();
}

function formatDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function buildMockOcrResult(item = {}, index = 0) {
  const fallbackDate = new Date(Date.now() - (index * 86400000)).toISOString().slice(0, 10);
  const date = formatDate(item.date || item.runId) || fallbackDate;

  return {
    date,
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

async function analyzeScreenOcr(filename) {
  return visionService.analyzeImage(filename);
}

function pickItemMode(item = {}, job = {}) {
  const raw = String(item.mode || '').toLowerCase().trim();
  if (raw === 'vision' || raw === 'mock') return raw;

  if (item.useVision === true) return 'vision';
  if (job.use_vision_default === true) return 'vision';
  return 'mock';
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

async function analyzeBatchJob(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const job = payload.job && typeof payload.job === 'object' ? payload.job : {};
  const startedAt = new Date().toISOString();
  const results = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] || {};
    try {
      const mode = pickItemMode(item, job);
      let data;
      const requestedFilename = item.filename ? String(item.filename).trim() : null;
      const resolvedFilename = await resolveStoredFilenameInStore(requestedFilename);
      const useVision = mode === 'vision' && !!resolvedFilename;

      if (useVision && resolvedFilename) {
        data = await analyzeScreenOcr(resolvedFilename);
      } else {
        data = buildMockOcrResult(item, i);
      }

      results.push({
        item_id: item.item_id || item.itemId || null,
        index: i,
        ok: true,
        mode: useVision ? 'vision' : 'mock',
        input: {
          filename: resolvedFilename || requestedFilename,
          runId: item.runId || item.run_id || null,
          date: item.date || null,
          requested_mode: mode,
          fallback_reason: !useVision && mode === 'vision' ? 'FILE_NOT_FOUND' : null
        },
        data
      });
    } catch (error) {
      results.push({
        item_id: item.item_id || item.itemId || null,
        index: i,
        ok: false,
        mode: 'vision',
        input: {
          filename: item.filename || null,
          runId: item.runId || item.run_id || null,
          date: item.date || null
        },
        error: error && error.message ? String(error.message) : 'Batch OCR mock failed'
      });
    }
  }

  const success = results.filter(r => r.ok).length;
  const failed = results.length - success;
  return {
    job: {
      job_id: job.job_id || payload.job_id || `mock-${Date.now()}`,
      source: job.source || 'manual',
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

const fs = require('fs').promises;
const path = require('path');
const geminiService = require('./gemini_service');

const RUN_COMMENT_ROOT = path.join(__dirname, 'data', 'run-comment');
const INBOX_DIR = path.join(RUN_COMMENT_ROOT, 'inbox');
const PROCESSED_DIR = path.join(RUN_COMMENT_ROOT, 'processed');
let scanPromise = null;

function normalizeDate(value) {
  const date = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function normalizeActivityId(value) {
  const activityId = String(value || '').trim();
  return /^[A-Za-z0-9_-]+$/.test(activityId) ? activityId : '';
}

function validatePayload(payload, filename) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Run Comment JSON must be an object');
  }
  const date = normalizeDate(payload.date);
  const activityId = normalizeActivityId(payload.activityId || payload.labelId);
  if (!date) throw new Error('Valid date is required (YYYY-MM-DD)');
  if (!activityId) throw new Error('Valid activityId is required');
  const expectedFilename = `run_${activityId}.json`;
  if (filename !== expectedFilename) throw new Error(`Filename must be ${expectedFilename}`);
  return { date, activityId };
}

function secondsToHms(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = String(Math.floor(total / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const secs = String(total % 60).padStart(2, '0');
  return `${hours}:${minutes}:${secs}`;
}

function buildDailySummary(payload, message = null) {
  const details = payload?.activityDetails && typeof payload.activityDetails === 'object' ? payload.activityDetails : {};
  const durationSeconds = Number(payload?.durationSeconds || 0);
  const distanceKm = Number(payload?.distanceKm ?? details.distanceKm ?? 0);
  const avgCadence = Number(details.averageCadenceSpm || 0);
  const avgStride = Number(details.averageStrideLengthM || 0) * 100;
  return {
    date: normalizeDate(payload?.date),
    step_count: avgCadence > 0 && durationSeconds > 0 ? Math.round((avgCadence * durationSeconds) / 60) : 0,
    total_distance_km: distanceKm > 0 ? distanceKm : 0,
    total_time: durationSeconds > 0 ? secondsToHms(durationSeconds) : String(details.totalTime || details.workoutTime || '').trim() || null,
    calories_kcal: Number(payload?.calories ?? details.calories ?? 0) || 0,
    avg_stride: avgStride > 0 ? Number(avgStride.toFixed(1)) : null,
    hr_avg: Number(payload?.averageHeartRate ?? details.averageHeartRate ?? 0) || null,
    avg_cadence: avgCadence > 0 ? avgCadence : null,
    avg_speed: distanceKm > 0 && durationSeconds > 0 ? Number(((distanceKm * 3600) / durationSeconds).toFixed(1)) : null,
    message: String(message || '').trim() || null
  };
}

async function ensureDailySummary(payload, repo, message) {
  const date = normalizeDate(payload?.date);
  if (!date) throw new Error('Valid date is required (YYYY-MM-DD)');
  const existing = await repo.getDailySummary(date);
  if (existing) {
    await repo.saveDailySummary({ date, message });
    return { created: false, summary: await repo.getDailySummary(date) };
  }
  await repo.saveDailySummary(buildDailySummary(payload, message));
  return { created: true, summary: await repo.getDailySummary(date) };
}

async function ensureDirectories() {
  await Promise.all([fs.mkdir(INBOX_DIR, { recursive: true }), fs.mkdir(PROCESSED_DIR, { recursive: true })]);
}

async function replaceProcessedFile(sourcePath, filename) {
  const targetPath = path.resolve(PROCESSED_DIR, filename);
  if (path.dirname(targetPath) !== path.resolve(PROCESSED_DIR)) throw new Error('Invalid processed filename');
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
  await fs.rename(sourcePath, targetPath);
  return targetPath;
}

async function importOneFile(filename, repo) {
  const sourcePath = path.resolve(INBOX_DIR, filename);
  if (path.dirname(sourcePath) !== path.resolve(INBOX_DIR)) throw new Error('Invalid inbox filename');
  const payload = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
  const normalized = validatePayload(payload, filename);
  const previous = await repo.getRunMessage(normalized.date, normalized.activityId);
  const generated = await geminiService.generateCorosRunComment(payload, previous?.message || '');
  await repo.saveRunMessage({ date: normalized.date, run_id: normalized.activityId, message: generated.message });
  await ensureDailySummary(payload, repo, generated.message);
  const enrichedPayload = {
    ...payload,
    message: generated.message,
    generatedBy: 'local_gemini',
    model: generated.model,
    generatedAt: new Date().toISOString()
  };
  const temporaryPath = `${sourcePath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(enrichedPayload, null, 2), 'utf8');
  await fs.rename(temporaryPath, sourcePath);
  const processedPath = await replaceProcessedFile(sourcePath, filename);
  return { filename, date: normalized.date, activityId: normalized.activityId, model: generated.model, processedPath };
}

async function scanInboxInternal(repo) {
  if (!repo || typeof repo.saveRunMessage !== 'function' || typeof repo.getRunMessage !== 'function' || typeof repo.getDailySummary !== 'function' || typeof repo.saveDailySummary !== 'function') {
    throw new Error('Run Comment repository is required');
  }
  await ensureDirectories();
  const names = (await fs.readdir(INBOX_DIR)).filter((name) => /^run_[A-Za-z0-9_-]+\.json$/.test(name)).sort();
  const imported = [];
  const failed = [];
  for (const name of names) {
    try {
      imported.push(await importOneFile(name, repo));
    } catch (error) {
      failed.push({ filename: name, error: error?.message || String(error) });
    }
  }
  return { imported, failed };
}

function scanInbox(repo) {
  if (scanPromise) return scanPromise;
  scanPromise = scanInboxInternal(repo).finally(() => { scanPromise = null; });
  return scanPromise;
}

module.exports = { INBOX_DIR, PROCESSED_DIR, buildDailySummary, scanInbox, validatePayload };

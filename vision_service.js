const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

// Constants
const STORE_DIR = path.join(__dirname, 'public/assets/store');
const PYTHON_SCRIPT = path.join(__dirname, 'tools', 'image_to_csv', 'screen_ocr_json.py');
const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const OCR_LANGUAGE = process.env.OCR_LANGUAGE || 'jpn+eng';
const TESSERACT_CMD = process.env.TESSERACT_CMD || '';
const TESSDATA_DIR = process.env.TESSDATA_DIR || '';
const OCR_FAST_MODE = String(process.env.OCR_FAST_MODE || '').toLowerCase() === '1'
  || String(process.env.OCR_FAST_MODE || '').toLowerCase() === 'true';

function toNumberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function normalizeDate(rawDate) {
  if (!rawDate) return null;
  const text = String(rawDate).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/**
 * Standardize stride calculation
 */
function calculateStride(distanceKm, stepCount) {
  if (!distanceKm || !stepCount || stepCount === 0) return null;
  const stride = (distanceKm * 100000) / stepCount;
  return parseFloat(stride.toFixed(2));
}

/**
 * Calculate Average Cadence from Steps and Time
 * @param {number} steps
 * @param {string} timeStr "HH:MM:SS" or "MM:SS"
 */
function calculateCadence(steps, timeStr) {
  if (!steps || !timeStr) return 0;

  const parts = String(timeStr).split(':').map(Number);
  let minutes = 0;

  if (parts.length === 3) {
    minutes = parts[0] * 60 + parts[1] + parts[2] / 60;
  } else if (parts.length === 2) {
    minutes = parts[0] + parts[1] / 60;
  } else {
    return 0;
  }

  if (minutes === 0) return 0;
  return Math.round(steps / minutes);
}

function runPythonOcr(filePath) {
  return new Promise((resolve, reject) => {
    const args = [PYTHON_SCRIPT, '--image', filePath, '--language', OCR_LANGUAGE];
    if (TESSERACT_CMD) {
      args.push('--tesseract-cmd', TESSERACT_CMD);
    }
    if (TESSDATA_DIR) {
      args.push('--tessdata-dir', TESSDATA_DIR);
    }
    if (OCR_FAST_MODE) {
      args.push('--fast');
    }

    const child = spawn(PYTHON_BIN, args, { cwd: __dirname });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python OCR failed with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Invalid OCR JSON: ${e.message}`));
      }
    });
  });
}

/**
 * Analyze image using Python OCR
 */
async function analyzeImage(filename) {
  try {
    const filePath = path.join(STORE_DIR, filename);
    await fs.access(filePath);
    await fs.access(PYTHON_SCRIPT);

    const data = await runPythonOcr(filePath);
    const result = {
      date: normalizeDate(data.date),
      step_count: toIntOrNull(data.step_count),
      total_distance_km: toNumberOrNull(data.total_distance_km),
      total_time: data.total_time ? String(data.total_time) : null,
      avg_heart_rate: toIntOrNull(data.avg_heart_rate),
      max_heart_rate: toIntOrNull(data.max_heart_rate),
      avg_speed: toNumberOrNull(data.avg_speed),
      max_speed: toNumberOrNull(data.max_speed),
      avg_stride_cm: toNumberOrNull(data.avg_stride_cm),
      max_stride_cm: toNumberOrNull(data.max_stride_cm),
      avg_cadence: toIntOrNull(data.avg_cadence),
      max_cadence: toIntOrNull(data.max_cadence)
    };

    if (result.step_count && result.total_distance_km && (!result.avg_stride_cm || result.avg_stride_cm === 0)) {
      result.avg_stride_cm = calculateStride(result.total_distance_km, result.step_count);
    }
    if (result.step_count && result.total_time && (!result.avg_cadence || result.avg_cadence === 0)) {
      result.avg_cadence = calculateCadence(result.step_count, result.total_time);
    }

    return result;
  } catch (err) {
    console.error('Vision Analysis Error:', err);
    throw err;
  }
}

module.exports = {
  analyzeImage,
  calculateStride,
  calculateCadence
};

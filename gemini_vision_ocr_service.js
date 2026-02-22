const path = require('path');
const fs = require('fs').promises;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const STORE_DIR = path.join(__dirname, 'public/assets/store');
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_VISION_OCR_MODEL = String(process.env.GEMINI_VISION_OCR_MODEL || 'gemini-2.0-flash').trim();

function toNumberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function normalizeDate(rawDate) {
  if (!rawDate) return null;
  const text = String(rawDate).trim().replace(/\//g, '-');
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const digits = text.replace(/[^0-9]/g, '');
  const m = digits.match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function normalizeTime(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) return text.padStart(8, '0');
  if (/^\d{1,2}:\d{2}$/.test(text)) return text;
  return null;
}

function tryExtractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const noFence = raw
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(noFence);
  } catch (_) {
    // continue
  }

  const first = noFence.indexOf('{');
  const last = noFence.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const fragment = noFence.slice(first, last + 1);
    try {
      return JSON.parse(fragment);
    } catch (_) {
      return null;
    }
  }
  return null;
}

async function analyzeImage(filename) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is required for vision OCR mode');
  }

  const filePath = path.join(STORE_DIR, filename);
  const imageBuffer = await fs.readFile(filePath);
  const ext = path.extname(filename).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: GEMINI_VISION_OCR_MODEL });

  const prompt = [
    'Extract running summary metrics from this screenshot.',
    'Return ONLY one JSON object with keys exactly:',
    'date, step_count, total_distance_km, total_time, avg_heart_rate, max_heart_rate, avg_speed, max_speed, avg_stride_cm, max_stride_cm, avg_cadence, max_cadence',
    'Use null when unknown.',
    'date must be YYYY-MM-DD.',
    'total_time must be HH:MM:SS or MM:SS.'
  ].join('\n');

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: imageBuffer.toString('base64'),
        mimeType
      }
    }
  ]);
  const response = await result.response;
  const text = String(response.text() || '').trim();
  const parsed = tryExtractJson(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Vision OCR returned non-JSON response');
  }

  return {
    date: normalizeDate(parsed.date),
    step_count: toIntOrNull(parsed.step_count),
    total_distance_km: toNumberOrNull(parsed.total_distance_km),
    total_time: normalizeTime(parsed.total_time),
    avg_heart_rate: toIntOrNull(parsed.avg_heart_rate),
    max_heart_rate: toIntOrNull(parsed.max_heart_rate),
    avg_speed: toNumberOrNull(parsed.avg_speed),
    max_speed: toNumberOrNull(parsed.max_speed),
    avg_stride_cm: toNumberOrNull(parsed.avg_stride_cm),
    max_stride_cm: toNumberOrNull(parsed.max_stride_cm),
    avg_cadence: toIntOrNull(parsed.avg_cadence),
    max_cadence: toIntOrNull(parsed.max_cadence)
  };
}

module.exports = {
  analyzeImage
};

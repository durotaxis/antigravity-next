const path = require('path');
const fs = require('fs').promises;
const { GoogleGenerativeAI } = require('@google/generative-ai');

const STORE_DIR = path.join(__dirname, 'public/assets/store');
const GEMINI_API_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const GEMINI_VISION_OCR_MODEL = String(process.env.GEMINI_VISION_OCR_MODEL || 'gemini-3-flash-preview').trim();

function toNumberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toHalfWidthDigits(value) {
  return String(value || '').replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

function inferYear(month, currentDate = new Date()) {
  const currentMonth = currentDate.getMonth() + 1;
  const currentYear = currentDate.getFullYear();
  return month > currentMonth ? (currentYear - 1) : currentYear;
}

function normalizeDate(rawDate, currentDate = new Date()) {
  if (!rawDate) return null;
  const text = toHalfWidthDigits(String(rawDate).trim())
    .replace(/[年.\-]/g, '/')
    .replace(/[月]/g, '/')
    .replace(/[日]/g, '')
    .replace(/\s+/g, '')
    .replace(/\/+/g, '/');

  let m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  m = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const mo = Number(m[1]);
    const d = Number(m[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const y = inferYear(mo, currentDate);
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  m = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return null;
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
  const today = new Date();
  const currentDateString = today.toISOString().split('T')[0];
  const currentYear = today.getFullYear();
  const lastYear = currentYear - 1;
  const currentMonth = today.getMonth() + 1;

  const prompt = [
    'Analyze this Google Fit activity screenshot and extract metrics into one JSON object.',
    'Return ONLY valid JSON (no markdown code block).',
    `Current Date: ${currentDateString}`,
    `Current Month: ${currentMonth}`,
    `Current Year: ${currentYear}`,
    `Last Year: ${lastYear}`,
    'Date rule: if screenshot date has no year (MM/DD), infer year using current month (if Image_Month > Current_Month then Last_Year else Current_Year).',
    'Use null when unknown.',
    'Keys exactly: date, step_count, total_distance_km, total_time, avg_heart_rate, max_heart_rate, avg_speed, max_speed, avg_stride_cm, max_stride_cm, avg_cadence, max_cadence',
    'date must be YYYY-MM-DD. total_time must be HH:MM:SS or MM:SS.'
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
    date: normalizeDate(parsed.date, today),
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

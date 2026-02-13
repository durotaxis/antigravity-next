const fs = require('fs').promises;
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

// Constants
const STORE_DIR = path.join(__dirname, 'public/assets/store');
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
    console.error("Error: GEMINI_API_KEY is not set in .env");
}

const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

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

    // YYYY/MM/DD
    let m = text.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    if (m) {
        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
            return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }

    // MM/DD (infer year)
    m = text.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (m) {
        const mo = Number(m[1]);
        const d = Number(m[2]);
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
            const y = inferYear(mo, currentDate);
            return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        }
    }

    // YYYYMMDD
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



/**
 * Standardize stride calculation
 */
function calculateStride(distanceKm, stepCount) {
    if (!distanceKm || !stepCount || stepCount === 0) return null;
    // (km * 100000) / steps = cm
    // Example: (15.41 * 100000) / 19000 = 81.1 cm
    const stride = (distanceKm * 100000) / stepCount;
    return parseFloat(stride.toFixed(2));
}

/**
 * Helper to get file as generative part
 */
async function fileToGenerativePart(filePath, mimeType) {
    const data = await fs.readFile(filePath);
    return {
        inlineData: {
            data: data.toString("base64"),
            mimeType,
        },
    };
}

/**
 * Analyze image using Gemini Vision
 */
async function analyzeImage(filename) {
    try {
        const filePath = path.join(STORE_DIR, filename);

        // Determine MIME Type based on extension
        const ext = path.extname(filename).toLowerCase();
        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        if (ext === '.webp') mimeType = 'image/webp';

        const imagePart = await fileToGenerativePart(filePath, mimeType);

        // --- construct dynamic prompt ---
        const today = new Date();
        const currentDateString = today.toISOString().split('T')[0];
        const currentYear = today.getFullYear();
        const lastYear = currentYear - 1;
        const currentMonth = today.getMonth() + 1; // 1-12

        const dynamicPrompt = `
Analyze this Google Fit activity screenshot and extract metrics into a JSON object.
Output ONLY valid JSON. Do not use Markdown code blocks.

=== CONTEXT ===
Current Date: ${currentDateString}
Current Month: ${currentMonth}
Current Year: ${currentYear}
Last Year: ${lastYear}
===============

Specific Instructions:
- **Date:** Look for the date at the top (e.g., "11月24日"). Format as "YYYY-MM-DD".
  [CRITICAL DATE INFERENCE RULE]:
  - If the date text has no year (e.g. "11/24"), compare Image_Month with Current_Month (${currentMonth}).
  - IF (Image_Month > Current_Month) THEN Use Year ${lastYear} (Assume it's from last year).
  - ELSE Use Year ${currentYear}.
  
- **Steps:** Look for the Shoe Icon (👟) to find the Step Count.
- **Heart Rate:** Look for the Heart Icon (❤️) or graph summary.
- **Cadence / Pitch:** Look for steps per minute (SPM). This might be labeled as "Cadence", "Pitch", or "ピッチ".
- **Stride:** Look for stride length (Avg/Max). If Max is not numeric but visible on graph, estimate it.
- **Speed:** Look for speed (km/h) or pace (min/km). If pace, convert to speed if possible, otherwise use null.
- **Values:** If a value is not clearly visible, use null.

Required Fields:
- date (string, YYYY-MM-DD)
- step_count (number)
- total_distance_km (number)
- total_time (string, e.g. "01:23:45")
- avg_heart_rate (number)
- max_heart_rate (number)
- avg_speed (number)
- max_speed (number)
- avg_stride_cm (number)
- max_stride_cm (number)
- avg_cadence (number)
- max_cadence (number)
`;

        const result = await model.generateContent([dynamicPrompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        // Parse JSON (clean up markdown if present, though prompt says don't use it)
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);
        data.date = normalizeDate(data.date, today) || data.date || null;

        // Post-Processing: Stride Calculation
        if (data.step_count && data.total_distance_km && (!data.avg_stride_cm || data.avg_stride_cm === 0)) {
            data.avg_stride_cm = calculateStride(data.total_distance_km, data.step_count);
            console.log(`Calculated Stride: ${data.avg_stride_cm} cm`);
        }

        // Post-Processing: Cadence Calculation (Fallback)
        if (data.step_count && data.total_time && (!data.avg_cadence || data.avg_cadence === 0)) {
            data.avg_cadence = calculateCadence(data.step_count, data.total_time);
            console.log(`Calculated Avg Cadence: ${data.avg_cadence} spm`);
        }


        return data;

    } catch (err) {
        console.error("Vision Analysis Error:", err);
        throw err;
    }
}

module.exports = {
    analyzeImage,
    calculateStride,
    calculateCadence
};

/**
 * Calculate Average Cadence from Steps and Time
 * @param {number} steps
 * @param {string} timeStr "HH:MM:SS" or "MM:SS"
 */
function calculateCadence(steps, timeStr) {
    if (!steps || !timeStr) return 0;

    // Parse time string to minutes
    const parts = timeStr.split(':').map(Number);
    let minutes = 0;

    if (parts.length === 3) {
        // HH:MM:SS
        minutes = parts[0] * 60 + parts[1] + parts[2] / 60;
    } else if (parts.length === 2) {
        // MM:SS
        minutes = parts[0] + parts[1] / 60;
    } else {
        return 0;
    }

    if (minutes === 0) return 0;

    // spm = steps / minutes
    return Math.round(steps / minutes);
}

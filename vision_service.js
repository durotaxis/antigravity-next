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
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });



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
- **Stride:** Look for stride length (Avg/Max). If Max is not numeric but visible on graph, estimate it.
- **Values:** If a value is not clearly visible, use null.

Required Fields:
- date (string, YYYY-MM-DD)
- step_count (number)
- total_distance_km (number)
- total_time (string, e.g. "01:23:45")
- avg_heart_rate (number)
- max_heart_rate (number)
- avg_stride_cm (number)
- max_stride_cm (number)
`;

        const result = await model.generateContent([dynamicPrompt, imagePart]);
        const response = await result.response;
        const text = response.text();

        // Parse JSON (clean up markdown if present, though prompt says don't use it)
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);

        // Post-Processing: Stride Calculation
        if (data.step_count && data.total_distance_km && (!data.avg_stride_cm || data.avg_stride_cm === 0)) {
            data.avg_stride_cm = calculateStride(data.total_distance_km, data.step_count);
            console.log(`Calculated Stride: ${data.avg_stride_cm} cm`);
        }


        return data;

    } catch (err) {
        console.error("Vision Analysis Error:", err);
        throw err;
    }
}

module.exports = {
    analyzeImage,
    calculateStride
};

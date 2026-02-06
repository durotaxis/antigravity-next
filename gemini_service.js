require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

const fs = require('fs').promises;
const path = require('path');

const BIOMECHANICS_RESEARCH = `
長距離走のバイオメカニクス的評価を用いる
`;

/**
 * Helper: Read image file to Gemini Part
 */
async function fileToPart(filePath) {
    const data = await fs.readFile(filePath);
    const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return {
        inlineData: {
            data: data.toString('base64'),
            mimeType
        }
    };
}

/**
 * Generate running advice based on daily metrics
 * @param {object} metrics { date, step_count, avg_stride_cm, avg_heart_rate, etc. }
 * @param {string[]} imagePaths List of absolute paths to images
 * @returns {Promise<string>} Advice text
 */
async function generateAdvice(metrics, imagePaths = []) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return "Gemini API Key is missing. Cannot generate advice.";
        }

        const prompt = `
            あなたはバイオメカニクスに基づいた専門的なランニングコーチです。
            ${BIOMECHANICS_RESEARCH}
            ユーザーの走行データに基づき、効率改善のためのアドバイスを100文字程度で日本語で提供してください。

            【ユーザーデータ】
            日付: ${metrics.date}
            歩数: ${metrics.step_count}歩
            距離: ${metrics.total_distance_km}km
            平均ストライド: ${metrics.avg_stride_cm}cm
            平均心拍数: ${metrics.avg_heart_rate}bpm
            平均ピッチ（ステップ頻度）: ${metrics.avg_cadence}spm

            また、添付されたスクリーンショット（もしあれば）から読み取れる特定の内容に基づいた「Geminiからの一言」も最後に追加してください。
        `;

        const parts = [prompt];
        if (imagePaths && imagePaths.length > 0) {
            for (const imgPath of imagePaths) {
                try {
                    parts.push(await fileToPart(imgPath));
                } catch (e) {
                    console.error("Failed to read image for Gemini:", imgPath, e.message);
                }
            }
        }

        const result = await model.generateContent(parts);
        const response = await result.response;
        return response.text().trim();

    } catch (error) {
        console.error("Gemini Generation Error:", error);
        return "AI Coach is currently unavailable.";
    }
}

/**
 * Generate advice from raw stats (Legacy/Client format)
 * @param {object} stats { date, avgStride, avgHR, maxStride, maxHR, avgCadence }
 * @param {string[]} imagePaths List of absolute paths to images
 */
async function generateCoachAdvice(stats, imagePaths = []) {
    try {
        if (!process.env.GEMINI_API_KEY) return "No API Key";

        const prompt = `
            あなたはバイオメカニクスに基づいた専門的なランニングコーチです。
            ${BIOMECHANICS_RESEARCH}
            データから「ランニングの効率性」を分析し、150文字以内で具体的な改善提案をしてください。

            【走行データ】
            日付: ${stats.date}
            平均ストライド: ${stats.avgStride}cm (最大: ${stats.maxStride}cm)
            平均心拍数: ${stats.avgHR}bpm (最大: ${stats.maxHR}bpm)
            平均ピッチ: ${stats.avgCadence || '不明'}spm
            
            また、添付されたスクリーンショット（もしあれば）から得られるインサイトを用いた「Geminiからの一言」も最後に追加してください。
        `;

        const parts = [prompt];
        if (imagePaths && imagePaths.length > 0) {
            for (const imgPath of imagePaths) {
                try {
                    parts.push(await fileToPart(imgPath));
                } catch (e) {
                    console.error("Failed to read image for Gemini Coach Advice:", imgPath, e.message);
                }
            }
        }

        const result = await model.generateContent(parts);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error("Gemini Coach Advice Error:", error);
        return "AI Analysis failed.";
    }
}

module.exports = { generateAdvice, generateCoachAdvice };

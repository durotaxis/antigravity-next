require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const fs = require('fs').promises;
const path = require('path');

const USER_HEIGHT_CM = 172;
const RATE_LIMIT_MESSAGE = "利用回数が制限を超えました。米国時間0:00のリセット後に再試行してください。";
const ANALYSIS_UNAVAILABLE_MESSAGE = "AI Analysis is currently unavailable.";

function isRateLimitError(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status);
    if (Number.isFinite(status) && status === 429) return true;

    const code = String(error?.code || error?.response?.data?.error?.status || '').toUpperCase();
    if (code.includes('RESOURCE_EXHAUSTED')) return true;

    const msg = String(error?.message || error || '').toLowerCase();
    return (
        msg.includes('429') ||
        msg.includes('too many request') ||
        msg.includes('too many requests') ||
        msg.includes('rate limit') ||
        msg.includes('quota') ||
        msg.includes('resource_exhausted')
    );
}

const THESIS_CONTENT = `
筑波大学・榎本靖士 博士論文「長距離走動作のバイオメカニクス的評価法に関する研究」における分析手法と留意点：
1. 動作の傾向把握（研究内での指標）：
   - ストライド型（SL-type）：相対的にステップ長（ストライド）が長く、頻度（ピッチ）が低い。
   - ピッチ型（SF-type）：相対的に頻度（ピッチ）が高く、ステップ長（ストライド）が短い。
2. 速度維持の傾向：
   - パフォーマンスの高い走者は後半にSL-type的特性への移行、あるいは維持によって速度を保つ傾向がある。
3. 基準値に関する重要な文脈（ユーザー指摘）：
   - 本論文の推奨指標（身長の1.11〜1.13倍のストライド）は、主にトップアスリートの走速度を基準としている。
   - 理想的なストライド長は、走速度（Velocity = Stride × Cadence）の割合に比例して変化するものであり、低速走行時に一律にトップレベルの比率を適用すべきではない。
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
 * Advice Generator
 */
async function generateAdvice(metrics, imagePaths = []) {
    try {
        if (!process.env.GEMINI_API_KEY) return "No API Key";
        const stats = {
            date: metrics.date,
            avgStride: metrics.avg_stride_cm,
            maxStride: metrics.max_stride_cm || metrics.avg_stride_cm,
            avgHR: metrics.avg_heart_rate,
            maxHR: metrics.max_heart_rate || metrics.avg_heart_rate,
            avgCadence: metrics.avg_cadence,
            maxCadence: metrics.max_cadence || metrics.avg_cadence,
            avgSpeed: metrics.avg_speed || 0,
            maxSpeed: metrics.max_speed || 0
        };
        return await generateCoachAdvice(stats, imagePaths);
    } catch (e) {
        if (isRateLimitError(e)) {
            return RATE_LIMIT_MESSAGE;
        }
        console.error("Gemini generateAdvice failed:", e && e.message ? e.message : e);
        return ANALYSIS_UNAVAILABLE_MESSAGE;
    }
}

/**
 * Generate Analysis (Gemini 3 Flash Preview)
 */
async function generateCoachAdvice(stats, imagePaths = []) {
    try {
        if (!process.env.GEMINI_API_KEY) return "No API Key";

        const prompt = `
            あなたはバイオメカニクス専門のデータアナリストです。
            ${THESIS_CONTENT}
            【分析の指針】
            1. 走速度の最大効率点（最大速度時）の評価として、今回の「最大ストライド（${stats.maxStride}cm）」が、トップレベルの推奨指標（${(USER_HEIGHT_CM * 1.11).toFixed(1)}cm〜）に対してどこまで到達しているかを客観的に比較してください。
            2. ピークパフォーマンス（最大値）のセグメントにおいて、ストライドとピッチのどちらが速度維持（あるいは心拍数への反応）に寄与しているか。
            3. 最大ピッチ（例：180spm超）が記録されている場合、その瞬間の爆発的な出力を認め、単なる「平均ピッチの向上」といった的外れな助言を避けること。
            4. 画像がある場合は、そこから得られる視覚的情報の洞察を1点追加すること。
            5. 【新規】最大速度（${stats.maxSpeed}km/h）のコンテキストを評価して下さい。現在のストライドとピッチでこの速度が出ている効率性について。
            提供されたデータの速度レベルを考慮し、100文字〜150文字程度の日本語で分析を提示してください。
            「身長の1.11〜1.13倍」はあくまでトップレベルの最大目標値であることを踏まえ、現在の速度におけるストライドの妥当性を洞察してください。

            【走行データ】
            日付: ${stats.date}
            ストライド: 平均 ${stats.avgStride}cm / 最大 ${stats.maxStride}cm
            ピッチ: 平均 ${stats.avgCadence || '不明'}spm / 最大 ${stats.maxCadence || '不明'}spm
            心拍数: 平均 ${stats.avgHR}bpm / 最大 ${stats.maxHR}bpm
            速度: 平均 ${stats.avgSpeed}km/h / 最大 ${stats.maxSpeed}km/h
        `;

        const parts = [prompt];
        if (imagePaths && imagePaths.length > 0) {
            for (const imgPath of imagePaths) {
                try {
                    parts.push(await fileToPart(imgPath));
                } catch (e) {
                    console.error("Failed to read image:", imgPath);
                }
            }
        }

        const result = await model.generateContent(parts);
        const response = await result.response;
        return response.text().trim();

    } catch (error) {
        if (isRateLimitError(error)) return RATE_LIMIT_MESSAGE;
        console.error("Gemini generateCoachAdvice failed:", error && error.message ? error.message : error);
        return ANALYSIS_UNAVAILABLE_MESSAGE;
    }
}

module.exports = { generateAdvice, generateCoachAdvice, RATE_LIMIT_MESSAGE };

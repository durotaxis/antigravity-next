require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

/**
 * Generate running advice based on daily metrics
 * @param {object} metrics { date, step_count, avg_stride_cm, avg_heart_rate, etc. }
 * @returns {Promise<string>} Advice text
 */
async function generateAdvice(metrics) {
    try {
        if (!process.env.GEMINI_API_KEY) {
            return "Gemini API Key is missing. Cannot generate advice.";
        }

        const prompt = `
            あなたはプロのランニングコーチです。
            以下のランニングデータに基づいて、効率的なランニングフォームやトレーニングについて、100文字以内で日本語のアドバイスをください。
            特に、ストライドの長さ (${metrics.avg_stride_cm}cm) と 心拍数 (${metrics.avg_heart_rate}bpm) のバランスに着目してください。

            データ:
            日付: ${metrics.date}
            歩数: ${metrics.step_count}歩
            距離: ${metrics.total_distance_km}km
            カロリー: ${metrics.calories_kcal}kcal
            平均ストライド: ${metrics.avg_stride_cm}cm
            平均心拍数: ${metrics.avg_heart_rate}bpm
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();

    } catch (error) {
        console.error("Gemini Generation Error:", error);
        return "AI Coach is currently unavailable.";
    }
}

/**
 * Generate advice from raw stats (Legacy/Client format)
 * @param {object} stats { date, avgStride, avgHR, maxStride, maxHR }
 */
async function generateCoachAdvice(stats) {
    try {
        if (!process.env.GEMINI_API_KEY) return "No API Key";

        const prompt = `
            あなたはプロのランニングコーチです。
            日付: ${stats.date}
            平均ストライド: ${stats.avgStride}cm (最大: ${stats.maxStride}cm)
            平均心拍数: ${stats.avgHR}bpm (最大: ${stats.maxHR}bpm)
            
            このデータから、ランニングの「効率性」について100文字以内で日本語のアドバイスをください。
            特に、ストライドを伸ばしつつ心拍数を抑えられているかどうかに着目してください。
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error("Gemini Coach Advice Error:", error);
        return "AI Analysis failed.";
    }
}

module.exports = { generateAdvice, generateCoachAdvice };

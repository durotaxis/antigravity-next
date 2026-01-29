require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- 設定 ---
const API_KEY = process.env.GEMINI_API_KEY;
const STORE_DIR = './public/assets/store';

// ★ここを実際のファイル名に書き換えてください (例: 'image_12345.png')
const TARGET_IMAGE = '2fb37d52004d970fef6abac99081d6a9aebfeca9f134710c4e1f59db349fcbe8.png'; 

// --- Vision API 実行関数 ---
async function analyzeImage() {
    // 1. APIキーの確認
    if (!API_KEY) {
        console.error("❌ Error: GEMINI_API_KEY is not set in .env");
        return;
    }

    // 2. ファイルパスの確認
    const imagePath = path.join(STORE_DIR, TARGET_IMAGE);
    if (!fs.existsSync(imagePath)) {
        console.error(`❌ Error: File not found at ${imagePath}`);
        return;
    }

    // 3. 拡張子からMIMEタイプを自動判定 (PNG/JPG対応)
    const ext = path.extname(TARGET_IMAGE).toLowerCase();
    let mimeType = "image/jpeg"; // デフォルト
    if (ext === '.png') {
        mimeType = "image/png";
    } else if (ext === '.webp') {
        mimeType = "image/webp";
    }

    console.log(`🔍 Analyzing ${TARGET_IMAGE} (${mimeType}) with Gemini Vision...`);

    // 4. 画像データの準備
    const imageBuffer = fs.readFileSync(imagePath);
    const imageBase64 = imageBuffer.toString('base64');

// 5. プロンプト（解析指示）
    const prompt = `
    Analyze this Google Fit activity screenshot and extract metrics into a JSON object.
    Output ONLY valid JSON.

    Specific Instructions:
    - Look for the **Shoe Icon (👟)** to find the Step Count.
    - Look for the Date typically at the top (e.g., "1月24日"), and format it as "YYYY-MM-DD" (use current year 2026 if year is missing).

    Required Fields:
    - date (string, "YYYY-MM-DD")
    - step_count (number, look for shoe icon 👟)
    - total_distance_km (number)
    - total_time (string)
    - avg_heart_rate (number, bpm)
    - calories_kcal (number)

    Image data:
    `;
    
    try {
        // 6. Gemini API呼び出し
        const genAI = new GoogleGenerativeAI(API_KEY);
        // 実験用に高速な Flash モデルを使用 (ProでもOK)
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const result = await model.generateContent([
            prompt,
            {
                inlineData: {
                    data: imageBase64,
                    mimeType: mimeType,
                },
            },
        ]);

        const response = await result.response;
        const text = response.text();
        
        console.log("\n--- 🤖 Gemini Analysis Result (Raw) ---");
        console.log(text);
        console.log("---------------------------------------\n");

        // 7. JSONパース確認
        try {
            // Markdown記法 (```json ... ```) が混じっていたら削除してパース
            const cleanJson = text.replace(/```json|```/g, '').trim();
            const data = JSON.parse(cleanJson);
            console.log("✅ JSON Parsed Successfully! データ抽出成功:");
            console.log(data);
        } catch (e) {
            console.warn("⚠️ Could not parse JSON directly. Check the raw output above.");
        }

    } catch (error) {
        console.error("❌ Error calling Gemini API:", error);
    }
}

// 実行
analyzeImage();
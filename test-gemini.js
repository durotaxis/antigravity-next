require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

// キーの読み込み
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function run() {
  // モデルの選択（最新のGemini 1.5 Flashなど）
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  const prompt = "あなたはプロのランニングコーチです。私（エンジニア、62歳）に一言挨拶してください。";

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    console.log("--- Geminiからの返答 ---");
    console.log(text);
  } catch (error) {
    console.error("エラーが発生しました:", error);
  }
}

run();
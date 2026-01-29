require('dotenv').config();

const API_KEY = process.env.GEMINI_API_KEY;
// 直接REST APIを叩いて、使えるモデル一覧を取得するURL
const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

async function listModels() {
  console.log("Googleのサーバーに問い合わせ中...");
  console.log(`Key (最初の5文字): ${API_KEY ? API_KEY.substring(0, 5) : 'なし'}`);

  try {
    const response = await fetch(URL);
    const data = await response.json();

    if (data.error) {
      console.error("❌ APIエラーが発生しました:");
      console.error(JSON.stringify(data.error, null, 2));
      return;
    }

    if (!data.models) {
      console.log("⚠️ モデルが見つかりませんでした。");
      console.log("レスポンス:", data);
      return;
    }

    console.log("\n✅ あなたのキーで使用可能なモデル一覧:");
    // "generateContent"（会話機能）に対応しているものだけ抽出
    const chatModels = data.models
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
      .map(m => m.name.replace("models/", "")); // "models/" を削除して表示

    chatModels.forEach(name => console.log(`- ${name}`));

  } catch (error) {
    console.error("❌ 通信エラー:", error);
  }
}

listModels();
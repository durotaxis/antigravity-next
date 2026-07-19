require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MAX_IMAGES = Math.max(0, Math.min(3, Number(process.env.OPENAI_MAX_ADVICE_IMAGES || 2)));

function buildTrainingLoadPrompt(context) {
  if (!context || typeof context !== 'object') return '';
  return [
    '',
    '秒単位の運動負荷区間:',
    `- LT近接 (${context.nearLtThreshold || '-'} bpm以上): 合計 ${Math.round(Number(context.nearLt?.totalSeconds || 0))}秒 / ${Math.round(Number(context.nearLt?.ratio || 0) * 100)}% / ${Number(context.nearLt?.count || 0)}区間 / 最長 ${Math.round(Number(context.nearLt?.longestSeconds || 0))}秒`,
    `- 走行中リカバリ (${context.recoveredThreshold || '-'} bpm以下まで): ${Number(context.movingRecovery?.count || 0)}回 / 平均 ${Math.round(Number(context.movingRecovery?.averageSeconds || 0))}秒 / 平均心拍低下 ${Math.round(Number(context.movingRecovery?.averageHeartRateDrop || 0))} bpm`,
    `- 完全休息: 合計 ${Math.round(Number(context.completeRest?.totalSeconds || 0))}秒 / ${Number(context.completeRest?.count || 0)}回 / 最長 ${Math.round(Number(context.completeRest?.longestSeconds || 0))}秒`,
    'LT近接、走行中リカバリ、完全休息を区別して評価する。完全休息をペース失速や走力低下として扱わない。0の項目には無理に言及しない。'
  ].join('\n');
}

function buildCompleteRestPrompt(windows) {
  const restWindows = Array.isArray(windows) ? windows : [];
  const time = (timestampMs) => new Date(Number(timestampMs)).toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  return [
    '',
    '完全休止時間帯:',
    ...(restWindows.length > 0
      ? restWindows.map((window) => {
          const hasHeartRate = Number.isFinite(Number(window.startHeartRate)) && Number.isFinite(Number(window.endHeartRate));
          const change = Number(window.heartRateChange);
          const heartRateText = hasHeartRate
            ? ` / 心拍 ${Math.round(Number(window.startHeartRate))}→${Math.round(Number(window.endHeartRate))} bpm（${change > 0 ? '+' : ''}${Math.round(change)} bpm）`
            : ' / 心拍データなし';
          return `- ${time(window.startTimestampMs)}–${time(window.endTimestampMs)}（${Math.round(Number(window.durationSeconds))}秒）${heartRateText}`;
        })
      : ['- 検出なし']),
    '',
    '走行構造がインターバルトレーニングと判断できる場合は、完全休止の長さと配置も含めて評価してください。',
    '評価の参考として、ダニエルズ、カノーバ、ノルウェー式のトレーニング原則を利用して構いません。',
    'ただし、走行データから判別できない方式名を断定しないでください。',
    '乳酸値がない場合は、乳酸コントロールを行ったとは断定しないでください。',
    '完全休止中の心拍変化にはセンサー遅延が含まれるため、回復能力や乳酸除去を断定しないでください。',
    '今回の走行データから、次回のトレーニングについて有用な助言ができる場合は、一つ提案してください。',
    '軽いJOGで心拍と走行動作が安定している場合は、活動的回復を含むインターバルなど、少し負荷を加える選択肢を提案して構いません。',
    '軽いJOGが安定している場合は、完全休止に入る前に短いRペース走を入れると、速い動作を維持する神経筋系への刺激になることを助言して構いません。Rペース走を全力スプリントとは表現しないでください。',
    '疲労、心拍の不安定さ、フォームの低下が見られる場合は、負荷を増やさず、軽いJOGや回復を提案してください。',
    '提案する場合は、目的、疾走時間、回復時間、反復回数を具体的に示してください。',
    '回復は原則として活動的回復とし、完全休止は短い全力疾走の質、安全上の必要、または今回のデータ上の明確な理由がある場合に限ってください。',
    'データから適切な助言ができない場合は、無理にトレーニングメニューを作らないでください。'
  ].join('\n');
}

async function imagePathToDataUrl(filePath) {
  const abs = path.resolve(filePath);
  const data = await fs.readFile(abs);
  const ext = path.extname(abs).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${data.toString('base64')}`;
}

function buildPromptText(maxStats, imagePaths = [], extraContext = {}) {
  const minuteTableMarkdown = String(extraContext?.minuteTableMarkdown || '').trim();
  const latestRunSummary = extraContext?.latestRunSummary && typeof extraContext.latestRunSummary === 'object'
    ? extraContext.latestRunSummary
    : null;
  const lthrContext = extraContext?.lthrContext && typeof extraContext.lthrContext === 'object'
    ? extraContext.lthrContext
    : null;
  const compareRunSummaries = Array.isArray(extraContext?.compareRunSummaries)
    ? extraContext.compareRunSummaries.slice(-8)
    : [];

  const lthrValue = Number(lthrContext?.lthr);
  const lthrExceededSeconds = Number(lthrContext?.exceededSeconds);
  const lthrExceededRatio = Number(lthrContext?.exceededRatio);
  const hasLthrContext = Number.isFinite(lthrValue) && lthrValue > 0;

  const latestRunText = latestRunSummary
    ? `最新ラン: ${String(latestRunSummary.date || '')} / 距離 ${Number(latestRunSummary.distanceKm || 0).toFixed(2)}km / Max Stride ${Number(latestRunSummary.maxStride || 0).toFixed(1)}cm / Avg Stride ${Number(latestRunSummary.avgStride || 0).toFixed(1)}cm / Avg Speed ${Number(latestRunSummary.avgSpeed || 0).toFixed(1)}km/h / Avg Pitch ${Math.round(Number(latestRunSummary.avgPitch || 0))}spm / Avg HR ${Math.round(Number(latestRunSummary.avgHr || 0))}bpm`
    : '最新ラン: なし';

  const compareRunsText = compareRunSummaries.length > 0
    ? compareRunSummaries
        .map((run) => `- ${String(run.date || '')}: ${Number(run.distanceKm || 0).toFixed(2)}km, MaxStride ${Number(run.maxStride || 0).toFixed(1)}cm, AvgStride ${Number(run.avgStride || 0).toFixed(1)}cm, AvgSpeed ${Number(run.avgSpeed || 0).toFixed(1)}km/h, AvgPitch ${Math.round(Number(run.avgPitch || 0))}spm, AvgHR ${Math.round(Number(run.avgHr || 0))}bpm`)
        .join('\n')
    : '- なし';

  let basePrompt = [
    'あなたはバイオメカニクス重視のランニング分析コーチです。以下のランニング数値と文脈を読み、日本語で実用的な分析コメントを書いてください。',
    '方針:',
    '1. 最大ストライド、平均ストライド、平均ピッチ、最大速度の関係から今回の走りの特徴を判断する',
    '2. ストライドとピッチの組み合わせから、回転寄りかストライド寄りかを具体的に述べる',
    '3. チャート画像や1分毎テーブルがある場合は、その数値や変化を分析文の中に自然に織り込む',
    `4. 最大速度 ${maxStats.maxSpeed}km/h を踏まえて、実際のストライドとピッチでその速度がどう出ているかを説明する`,
    '5. 心拍については、平均心拍・最大心拍・速度との関係から有酸素ベースで一言触れる',
    '6. 高度の上下や坂の影響が読み取れる場合は、その影響を分析として一言触れる',
    '7. 1分毎テーブル(MD)が渡された場合は、その内容から読み取れる気づきを必ず含める',
    '8. 高度については、チャートや1分毎テーブルの Altitude (m) 以外の情報は使わない',
    '9. 最新ランと比較ラン情報が与えられている場合は、前回ランまたは直近のある比較ラン1件をあなた自身で選び、比較を1文入れる',
    '10. LTHR とその超過時間が与えられていて、超過時間が長い場合は、その点にも一言触れる',
    '出力形式:',
    '- 1段落構成: 分析コメント、チャート所見、比較所見を自然につなげる',
    '- 2段落構成: 「1分毎テーブル所見: ...」で始める',
    'ルール:',
    '- 全文を120〜220文字程度の日本語に収める',
    '- 1段落目は3〜5文で簡潔に書く',
    '- 2段落目は1文だけにする',
    '- 心拍については褒め言葉だけではなく、今回の数値とその連動などの分析として書く',
    '- 高度については、上り下り・登坂・下り坂などの分析に絞って書き、一般論や推測は書かない',
    '- 1分毎テーブル(MD)がある場合は、その内容から読み取れる1つの具体所見を「1分毎テーブル所見: ...」で必ず1文書く',
    '- 1分毎テーブル(MD)がない場合は、「1分毎テーブル所見: ...」は書かない',
    '- 最新ランと比較ランがある場合は、比較所見を最新ランの前後どちらかに自然に入れる',
    '- LTHR超過時間が長い場合だけ、LTHRや超過時間の一文を最大1文だけ入れる',
    '',
    '与えられるデータ:',
    `日付: ${maxStats.date || '-'}`,
    `ストライド: 平均 ${maxStats.avgStride || '-'}cm / 最大 ${maxStats.maxStride || '-'}cm`,
    `ピッチ: 平均 ${maxStats.avgCadence || '-'}spm / 最大 ${maxStats.maxCadence || '-'}spm`,
    `心拍: 平均 ${maxStats.avgHR || '-'}bpm / 最大 ${maxStats.maxHR || '-'}bpm`,
    `速度: 平均 ${maxStats.avgSpeed || '-'}km/h / 最大 ${maxStats.maxSpeed || '-'}km/h`,
    '',
    'コンテキスト判定:',
    `画像: ${Array.isArray(imagePaths) && imagePaths.length > 0 ? 'あり' : 'なし'}`,
    `1分毎テーブル(MD): ${minuteTableMarkdown ? 'あり' : 'なし'}`,
    `比較情報: ${compareRunSummaries.length > 0 && latestRunSummary ? 'あり' : 'なし'}`,
    `LTHR情報: ${hasLthrContext ? 'あり' : 'なし'}`,
    '',
    '比較情報:',
    latestRunText,
    '比較ラン一覧:',
    compareRunsText,
    'LTHR情報:',
    `- LTHR: ${hasLthrContext ? `${Math.round(lthrValue)} bpm` : 'なし'}`,
    `- 超過時間: ${Number.isFinite(lthrExceededSeconds) && lthrExceededSeconds > 0 ? `${Math.round(lthrExceededSeconds)}秒` : '0秒'}`,
    `- 超過率: ${Number.isFinite(lthrExceededRatio) && lthrExceededRatio > 0 ? `${Math.round(lthrExceededRatio * 100)}%` : '0%'}`
  ].join('\n');

  basePrompt += buildCompleteRestPrompt(extraContext?.completeRestWindows);
  if (!minuteTableMarkdown) return basePrompt;
  return `${basePrompt}\n追加コンテキスト: 以下は旧画面の1分毎テーブルです。必要に応じて分析に使ってください。\n\n${minuteTableMarkdown}`;
}

async function generateCoachMessage(maxStats, imagePaths = [], extraContext = {}) {
  if (!OPENAI_API_KEY) return 'No API Key';

  const parts = [
    {
      type: 'text',
      text: buildPromptText(maxStats, imagePaths, extraContext)
    }
  ];

  const limited = Array.isArray(imagePaths) ? imagePaths.slice(0, OPENAI_MAX_IMAGES) : [];
  for (const p of limited) {
    try {
      const dataUrl = await imagePathToDataUrl(p);
      parts.push({
        type: 'image_url',
        image_url: { url: dataUrl }
      });
    } catch {
      // ignore unreadable image
    }
  }

  const body = {
    model: OPENAI_MODEL,
    temperature: 0.5,
    max_tokens: 320,
    messages: [
      {
        role: 'user',
        content: parts
      }
    ]
  };

  const res = await axios.post(OPENAI_API_URL, body, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000
  });

  const message = res?.data?.choices?.[0]?.message?.content;
  return String(message || '').trim() || 'AI message is empty.';
}

module.exports = {
  generateCoachMessage
};

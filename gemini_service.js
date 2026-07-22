require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
        '1走行中、信号待ちなどで停止していることがあります。',
        '走行構造がインターバルトレーニングと判断できる場合は、完全休止の長さと配置も含めて評価してください。',
        '評価の参考として、ダニエルズ、カノーバ、ノルウェー式のトレーニング原則を利用して構いません。',
        'ただし、走行データから判別できない方式名を断定しないでください。',
        'ダニエルズ、バッケン、カノーバ、リディアード、ピーター・コーのランニング理論を参考に、今回の走行データに応じた次回のトレーニングアドバイスを追記してください。',
        '回答では専門用語や理論名を使わず、一般の人に分かる言葉で説明してください。'
    ].join('\n');
}

function buildPreviousRunCommentPrompt(comment) {
    const previousComment = String(comment || '').trim();
    if (!previousComment) return '';
    return [
        '',
        '前回のRUN COMMENT:',
        previousComment,
        '',
        '前回と実質的に同じ評価、所見、トレーニング提案は今回の回答から除外してください。',
        '今回のデータで新しく確認できた変化、異なる所見、新しい助言だけを書いてください。',
        '数値だけを言い換えて同じ内容を繰り返さないでください。'
    ].join('\n');
}

const FALLBACK_MODELS = [
    'gemini-3.6-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
];

async function generateContentWithFallback(parts, options = {}) {
    let lastError = null;

    for (const modelName of FALLBACK_MODELS) {
        console.log(`[GeminiService] Attempting generateContent with model: ${modelName}`);
        try {
            const modelInstance = genAI.getGenerativeModel({ model: modelName });
            const result = await modelInstance.generateContent(parts);
            const response = await result.response;
            const text = response.text().trim();
            console.log(`[GeminiService] Success with model: ${modelName}`);
            if (typeof options.onModelUsed === 'function') options.onModelUsed(modelName);
            return text;
        } catch (err) {
            lastError = err;
            const status = Number(err?.status || err?.statusCode || err?.response?.status);
            console.warn(`[GeminiService] Model ${modelName} failed: status=${status}. error=${err.message}`);
        }
    }

    throw lastError;
}

async function generateCorosRunComment(payload, previousRunComment = '') {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required');
    const details = payload?.activityDetails && typeof payload.activityDetails === 'object'
        ? payload.activityDetails
        : {};
    const sourceData = {
        date: payload?.date || null,
        location: payload?.location || null,
        durationSeconds: Number(payload?.durationSeconds || 0),
        distanceKm: Number(payload?.distanceKm || details.distanceKm || 0),
        averagePace: payload?.averagePace || details.averagePace || null,
        averageHeartRate: Number(payload?.averageHeartRate || details.averageHeartRate || 0),
        calories: Number(payload?.calories || details.calories || 0),
        activityDetails: details
    };
    const previous = String(previousRunComment || '').trim();
    const prompt = [
        '以下のCOROSランニング活動データから、日本語のRUN COMMENTを作成してください。',
        '120〜240文字程度の一段落にまとめ、走りの特徴、負荷の評価、次回への短い助言を含めてください。',
        'データにない最大値、区間変化、地形、理論名を推測しないでください。専門用語はできるだけ避けてください。',
        previous
            ? '前回保存されたコメントと同じ言い回しや同じ観察の繰り返しを避け、今回のデータから確認できる別の重要点を優先してください。'
            : '',
        '',
        'COROS活動データ:',
        JSON.stringify(sourceData, null, 2),
        previous ? `\n前回保存されたRUN COMMENT:\n${previous}` : ''
    ].filter(Boolean).join('\n');
    let model = '';
    const message = await generateContentWithFallback([prompt], {
        onModelUsed: (modelName) => { model = modelName; }
    });
    if (!String(message || '').trim()) throw new Error('Gemini returned an empty Run Comment');
    return { message: String(message).trim(), model };
}


const fs = require('fs').promises;

const ANALYSIS_UNAVAILABLE_MESSAGE = 'AI Analysis is currently unavailable.';
const TEMPORARY_UNAVAILABLE_MESSAGE = '現在利用が制限されています。しばらくお待ちください。';

function isRateLimitError(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status);
    if (Number.isFinite(status) && (status === 429 || status === 503)) return true;

    const code = String(error?.code || error?.response?.data?.error?.status || '').toUpperCase();
    if (code.includes('RESOURCE_EXHAUSTED')) return true;

    const msg = String(error?.message || error || '').toLowerCase();
    return (
        msg.includes('429') ||
        msg.includes('503') ||
        msg.includes('too many request') ||
        msg.includes('too many requests') ||
        msg.includes('rate limit') ||
        msg.includes('service unavailable') ||
        msg.includes('quota') ||
        msg.includes('resource_exhausted')
    );
}

function getErrorStatus(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status);
    return Number.isFinite(status) ? status : 'unknown';
}

function formatErrorStatusLabel(error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status);
    if (status === 429) return '429 Too Many Requests';
    if (status === 503) return '503 Service Unavailable';
    return String(getErrorStatus(error));
}

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

function dataUrlToPart(dataUrl) {
    const text = String(dataUrl || '').trim();
    const match = text.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return null;
    return {
        inlineData: {
            data: match[2],
            mimeType: match[1]
        }
    };
}

async function generateAdvice(metrics, imagePaths = [], extraContext = {}) {
    try {
        if (!process.env.GEMINI_API_KEY) return 'No API Key';
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
        return await generateCoachAdvice(stats, imagePaths, extraContext);
    } catch (e) {
        console.error(`[GeminiError] status=${formatErrorStatusLabel(e)}`);
        if (isRateLimitError(e)) return TEMPORARY_UNAVAILABLE_MESSAGE;
        console.error('Gemini generateAdvice failed:', e && e.message ? e.message : e);
        return ANALYSIS_UNAVAILABLE_MESSAGE;
    }
}

async function generateCoachAdvice(stats, imagePaths = [], extraContext = {}) {
    try {
        if (!process.env.GEMINI_API_KEY) return 'No API Key';

        const minuteTableMarkdown = String(extraContext?.minuteTableMarkdown || '').trim();
        const chartImagePart = dataUrlToPart(extraContext?.chartImageDataUrl);
        const hasImageContext = Boolean(chartImagePart) || (Array.isArray(imagePaths) && imagePaths.length > 0);
        const hasMinuteTableContext = minuteTableMarkdown.length > 0;

        const latestRunSummary = extraContext?.latestRunSummary && typeof extraContext.latestRunSummary === 'object'
            ? extraContext.latestRunSummary
            : null;
        const lthrContext = extraContext?.lthrContext && typeof extraContext.lthrContext === 'object'
            ? extraContext.lthrContext
            : null;
        const compareRunSummaries = Array.isArray(extraContext?.compareRunSummaries)
            ? extraContext.compareRunSummaries.slice(-8)
            : [];

        const hasCompareContext = Boolean(latestRunSummary) && compareRunSummaries.length > 0;
        const lthrValue = Number(lthrContext?.lthr);
        const lthrExceededSeconds = Number(lthrContext?.exceededSeconds);
        const lthrExceededRatio = Number(lthrContext?.exceededRatio);
        const hasLthrContext = Number.isFinite(lthrValue) && lthrValue > 0;
        const hasLthrExceededContext = hasLthrContext && Number.isFinite(lthrExceededSeconds) && lthrExceededSeconds > 0;

        const latestRunText = latestRunSummary
            ? `最新ラン: ${String(latestRunSummary.date || '')} / 距離 ${Number(latestRunSummary.distanceKm || 0).toFixed(2)}km / Max Stride ${Number(latestRunSummary.maxStride || 0).toFixed(1)}cm / Avg Stride ${Number(latestRunSummary.avgStride || 0).toFixed(1)}cm / Avg Speed ${Number(latestRunSummary.avgSpeed || 0).toFixed(1)}km/h / Avg Pitch ${Math.round(Number(latestRunSummary.avgPitch || 0))}spm / Avg HR ${Math.round(Number(latestRunSummary.avgHr || 0))}bpm`
            : '最新ラン: 不明';

        const compareRunsText = compareRunSummaries.length > 0
            ? compareRunSummaries
                .map((run) => `- ${String(run.date || '')}: ${Number(run.distanceKm || 0).toFixed(2)}km, MaxStride ${Number(run.maxStride || 0).toFixed(1)}cm, AvgStride ${Number(run.avgStride || 0).toFixed(1)}cm, AvgSpeed ${Number(run.avgSpeed || 0).toFixed(1)}km/h, AvgPitch ${Math.round(Number(run.avgPitch || 0))}spm, AvgHR ${Math.round(Number(run.avgHr || 0))}bpm`)
                .join('\n')
            : '- なし';

        let prompt = `
あなたはバイオメカニクス専門のランニング分析コーチです。
以下の前提を踏まえて、日本語で実用的な分析コメントを書いてください。

方針:
1. 最大ストライド、平均ストライド、平均ピッチ、最大速度の関係から今回の走りの特徴を評価する
2. ストライドとピッチの組み合わせから、回転寄りかストライド寄りかを観測ベースで簡潔に述べる
3. チャート画像があれば、その視覚的な傾向を総合分析の中に自然に織り込む
4. 最大速度 ${stats.maxSpeed}km/h も踏まえて、現在のストライドとピッチでその速度が出ている特徴を説明する
5. 心拍については、平均心拍・最大心拍・速度との関係から観測ベースで一言触れる
6. 高度の上下動や坂の影響が読み取れる場合は、その影響を観測として一言触れる
7. 画像や1分毎テーブル(MD)を渡された場合は、その内容を必ず反映する
8. 高度については、チャートの薄い背景や1分毎テーブルの Altitude (m) 列も手掛かりとして扱う
9. 最新ランと過去ラン候補が与えられている場合は、前回ランまたは意味のある過去ラン1件をあなた自身で選び、比較を1文入れる
10. LTHR とその超過時間が与えられていて、超過時間が0秒より大きい場合は、心拍コメントの中で必ずその超過時間または割合に一言触れる

出力形式:
- 1段落目: 総合分析。チャート画像がある場合は、その所見もこの段落に自然に含める
- 2段落目: 「1分毎テーブル所見: ...」で始める

必須ルール:
- 全体は220〜320文字程度に収める
- 1段落目は3〜5文で簡潔に書く
- 2段落目は1文だけにする
- 心拍については指示や処方ではなく、上昇傾向・安定・速度との連動などの観測として書く
- 高度については、上り下り・上下動・回復などの観測に限って書き、処方は書かない
- フォーム改善、股関節可動域、トップレベル比較、身長比、180spm目標などの一般論や指導口調は書かない
- 1分毎テーブル(MD)がある場合は、その内容から読み取れた点を「1分毎テーブル所見: ...」で必ず1文書く
- 1分毎テーブル(MD)がない場合は「1分毎テーブル所見: データなし」と書く
- 見出し名は「1分毎テーブル所見:」だけ必ずこの文言を使う
- 最新ランと過去ラン候補がある場合は、比較を最低1文含める
- LTHR超過時間が0秒より大きい場合だけ、LTHR値と超過時間または超過割合に最低1文節は触れる

与えるデータ:
日付: ${stats.date}
ストライド: 平均 ${stats.avgStride}cm / 最大 ${stats.maxStride}cm
ピッチ: 平均 ${stats.avgCadence || 'データなし'}spm / 最大 ${stats.maxCadence || 'データなし'}spm
心拍: 平均 ${stats.avgHR}bpm / 最大 ${stats.maxHR}bpm
速度: 平均 ${stats.avgSpeed}km/h / 最大 ${stats.maxSpeed}km/h

コンテキスト有無:
画像: ${hasImageContext ? 'あり' : 'なし'}
1分毎テーブル(MD): ${hasMinuteTableContext ? 'あり' : 'なし'}
比較候補: ${hasCompareContext ? 'あり' : 'なし'}
LTHR超過情報: ${hasLthrExceededContext ? 'あり' : 'なし'}

比較用補足:
${latestRunText}
過去ラン候補:
${compareRunsText}
LTHR補足:
- LTHR: ${hasLthrContext ? `${Math.round(lthrValue)} bpm` : '不明'}
- 超過時間: ${Number.isFinite(lthrExceededSeconds) && lthrExceededSeconds > 0 ? `${Math.round(lthrExceededSeconds)}秒` : '0秒'}
- 超過割合: ${Number.isFinite(lthrExceededRatio) && lthrExceededRatio > 0 ? `${Math.round(lthrExceededRatio * 100)}%` : '0%'}
`;

        prompt += buildCompleteRestPrompt(extraContext?.completeRestWindows);
        prompt += buildPreviousRunCommentPrompt(extraContext?.previousRunComment);
        const parts = [
            minuteTableMarkdown
                ? `${prompt}\n追加コンテキスト: 以下は旧画面の1分毎テーブルです。必要に応じて分析に使ってください。\n\n${minuteTableMarkdown}`
                : prompt
        ];

        if (imagePaths && imagePaths.length > 0) {
            for (const imgPath of imagePaths) {
                try {
                    parts.push(await fileToPart(imgPath));
                } catch (e) {
                    console.error('Failed to read image:', imgPath);
                }
            }
        }

        if (chartImagePart) {
            parts.push(chartImagePart);
        }

        return await generateContentWithFallback(parts);
    } catch (error) {
        console.error(`[GeminiError] status=${formatErrorStatusLabel(error)}`);
        if (isRateLimitError(error)) return TEMPORARY_UNAVAILABLE_MESSAGE;
        console.error('Gemini generateCoachAdvice failed:', error && error.message ? error.message : error);
        return ANALYSIS_UNAVAILABLE_MESSAGE;
    }
}

async function generateTrendChartAdvice(extraContext = {}) {
    try {
        if (!process.env.GEMINI_API_KEY) return 'No API Key';
        const chartImagePart = dataUrlToPart(extraContext?.chartImageDataUrl);
        if (!chartImagePart) {
            throw new Error('Chart image is required');
        }

        const dateRangeText = String(extraContext?.dateRangeText || '').trim();
        const runCountText = Number(extraContext?.runCount) > 0 ? `${Number(extraContext.runCount)} runs` : 'run count unknown';
        const maxDistanceDate = String(extraContext?.maxDistanceDate || '').trim();
        const maxDistanceKm = Number(extraContext?.maxDistanceKm);
        const hasMaxDistance = Number.isFinite(maxDistanceKm) && maxDistanceKm > 0;
        const latestRunSummary = extraContext?.latestRunSummary && typeof extraContext.latestRunSummary === 'object'
            ? extraContext.latestRunSummary
            : null;
        const chartRunSummaries = Array.isArray(extraContext?.chartRunSummaries)
            ? extraContext.chartRunSummaries.slice(-8)
            : [];

        const latestRunText = latestRunSummary
            ? `最新ラン: ${String(latestRunSummary.date || '')} / 距離 ${Number(latestRunSummary.distanceKm || 0).toFixed(2)}km / Max Stride ${Number(latestRunSummary.maxStride || 0).toFixed(1)}cm / Avg Speed ${Number(latestRunSummary.avgSpeed || 0).toFixed(1)}km/h / Avg Pitch ${Math.round(Number(latestRunSummary.avgPitch || 0))}spm / Avg HR ${Math.round(Number(latestRunSummary.avgHr || 0))}bpm`
            : '最新ラン: 不明';

        const runSummariesText = chartRunSummaries.length > 0
            ? chartRunSummaries
                .map((run) => `- ${String(run.date || '')}: ${Number(run.distanceKm || 0).toFixed(2)}km, MaxStride ${Number(run.maxStride || 0).toFixed(1)}cm, AvgSpeed ${Number(run.avgSpeed || 0).toFixed(1)}km/h, AvgPitch ${Math.round(Number(run.avgPitch || 0))}spm, AvgHR ${Math.round(Number(run.avgHr || 0))}bpm`)
                .join('\n')
            : '- なし';

        const prompt = `
あなたはランニングデータの観測コメントを書くアナリストです。
与えられた画像は、複数日の推移を並べたランニングチャートです。
1チャート目では、薄い背景が総走行距離を表しています。
最大距離の日付ラベルが見える場合、または補足情報で最大距離が与えられている場合は、その点に必ず一言触れてください。
補足情報の最新ランと過去ラン一覧を見て、前回ランまたは意味のある過去ラン1件をGemini自身で選び、比較を1文入れてください。

方針:
1. チャート画像から読み取れる傾向だけを書く
2. ストライド、速度、ピッチ、心拍の関係が見えれば触れる
3. 総走行距離の薄い背景や最大距離ラベルが見える場合は、その山やピークの位置も観測に含める
4. 上昇、低下、連動、ばらつき、ピークの位置などの観測を優先する
5. フォーム改善、目標値、身長比、一般的トレーニング指示は書かない

出力ルール:
- 日本語で3〜5文
- 全体は120〜220文字程度
- 画像から読み取れないことは断定しない
- 「チャート所見:」で始める
- 最大距離情報がある場合は、総走行距離のピークについて最低1文節は含める
- 最新ランと、前回ランまたは過去ラン1件との比較を最低1文含める

補足情報:
- 表示期間: ${dateRangeText || '不明'}
- 表示件数: ${runCountText}
- 1チャート目の薄い背景: 総走行距離
- 最大距離: ${hasMaxDistance ? `${maxDistanceKm.toFixed(2)} km` : '不明'}
- 最大距離日: ${maxDistanceDate || '不明'}
- ${latestRunText}
- 過去ラン候補:
${runSummariesText}
`;

        return await generateContentWithFallback([prompt, chartImagePart]);
    } catch (error) {
        console.error(`[GeminiError] status=${formatErrorStatusLabel(error)}`);
        if (isRateLimitError(error)) return TEMPORARY_UNAVAILABLE_MESSAGE;
        console.error('Gemini generateTrendChartAdvice failed:', error && error.message ? error.message : error);
        return ANALYSIS_UNAVAILABLE_MESSAGE;
    }
}

module.exports = { generateAdvice, generateCoachAdvice, generateTrendChartAdvice, generateCorosRunComment, TEMPORARY_UNAVAILABLE_MESSAGE };

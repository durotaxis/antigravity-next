const fs = require('fs');
const path = require('path');

// ★JSONデータの保存場所 (storageフォルダと仮定)
// 環境に合わせて変更してください
const DATA_DIR = path.join(__dirname, 'storage');

/**
 * vNext-Chart-01仕様: 5P移動平均の最大値を算出する
 * @param {string} date - 'YYYY-MM-DD'
 */
// 共通のクリーニングロジック (google_fit_serviceと同じ基準)
function cleanDataMismatch(rawData) {
    if (!rawData || rawData.length === 0) return [];

    // Deep copy to avoid mutating original if needed
    const cleaned = rawData.map(d => ({ ...d }));

    for (let i = 0; i < cleaned.length; i++) {
        let point = cleaned[i];

        // 1. Interpolation (Spikes)
        if (shouldInterpolate(point, cleaned, i)) {
            point = interpolatePoint(cleaned, i);
        }

        // 2. Stride Ceiling (250cm)
        if (point.stride > 250) {
            point.stride = 0;
        }

        cleaned[i] = point;
        // Note: In analysis_service we might not be filtering by DeviceID because generic JSONs don't always have it.
        // We rely on the values themselves.
    }

    return cleaned;
}

function shouldInterpolate(point, allData, index) {
    // 1. Zero Drop (Heart Rate) but active steps
    if ((!point.heartRate || point.heartRate === 0) && point.steps > 10) return true;

    // 2. Impossible Jump (> 80bpm)
    if (index > 0 && index < allData.length - 1) {
        const prev = allData[index - 1];
        if (prev.heartRate > 0 && Math.abs(point.heartRate - prev.heartRate) > 80) return true;
    }
    return false;
}

function interpolatePoint(allData, index) {
    const point = { ...allData[index] };
    const prev = (index > 0) ? allData[index - 1] : null;
    const next = (index < allData.length - 1) ? allData[index + 1] : null;

    if (prev && next && prev.heartRate > 0 && next.heartRate > 0) {
        point.heartRate = Math.round((prev.heartRate + next.heartRate) / 2);
    } else if (prev && prev.heartRate > 0) {
        point.heartRate = prev.heartRate;
    } else if (next && next.heartRate > 0) {
        point.heartRate = next.heartRate;
    }
    return point;
}


/**
 * vNext-Chart-01仕様: 5P移動平均の最大値を算出する (Cleaned Data Only)
 * @param {string} date - 'YYYY-MM-DD'
 */
function calculateVNextMetrics(date) {
    try {
        // ★ Update: Read from CACHE
        const CACHE_DIR = path.join(DATA_DIR, 'cache');
        const filePath = path.join(CACHE_DIR, `intraday_${date}.json`);

        if (!fs.existsSync(filePath)) {
            return null;
        }

        const fileContent = fs.readFileSync(filePath, 'utf8');
        if (!fileContent) return null;

        const rawData = JSON.parse(fileContent);

        if (!Array.isArray(rawData) || rawData.length === 0) {
            return null;
        }

        // ★ Apply Cleaning First!
        const cleanedData = cleanDataMismatch(rawData);

        let max_stride_5p = 0;
        let max_hr_5p = 0;
        const windowSize = 5; // Unified to 5

        // 5点移動平均 (Simple Moving Average)
        for (let i = 0; i <= cleanedData.length - windowSize; i++) {
            const window = cleanedData.slice(i, i + windowSize);

            // フィルタ: 窓の中の全点が有効データであること (steps > 0 is strict enough for cleaned data?)
            // cleanDataMismatch keeps points even if they are interpolated, but if stride was nulled (>250), it is 0.
            const isValidWindow = window.every(p =>
                (p.steps > 0) && (p.stride > 0) // HR can be interpolated, Stride must be > 0 (under 250)
            );

            if (isValidWindow) {
                const avgStride = window.reduce((sum, p) => sum + p.stride, 0) / windowSize;
                const avgHr = window.reduce((sum, p) => sum + p.heartRate, 0) / windowSize;

                if (avgStride > max_stride_5p) max_stride_5p = avgStride;

                // For Max HR, usually we want the MAX HR derived from the loop, OR HR at Max Stride?
                // Old logic was simply "max of the smoothed averages".
                if (avgHr > max_hr_5p) max_hr_5p = avgHr;
            }
        }

        if (max_stride_5p === 0 && max_hr_5p === 0) {
            return null;
        }

        return {
            max_stride_5p: parseFloat(max_stride_5p.toFixed(1)),
            max_hr_5p: Math.round(max_hr_5p)
        };

    } catch (e) {
        console.error(`[Analysis] Calc Error for ${date}:`, e.message);
        return null;
    }
}

module.exports = { calculateVNextMetrics };
const fs = require('fs');
const path = require('path');

// ★JSONデータの保存場所 (storageフォルダと仮定)
// 環境に合わせて変更してください
const DATA_DIR = path.join(__dirname, 'storage'); 

/**
 * vNext-Chart-01仕様: 5P移動平均の最大値を算出する
 * @param {string} date - 'YYYY-MM-DD'
 */
function calculateVNextMetrics(date) {
    try {
        // ファイル名規則: run_YYYY-MM-DD.json
        const filePath = path.join(DATA_DIR, `run_${date}.json`);
        
        if (!fs.existsSync(filePath)) {
            return null; 
        }

        const fileContent = fs.readFileSync(filePath, 'utf8');
        if (!fileContent) return null;

        const rawData = JSON.parse(fileContent);

        if (!Array.isArray(rawData) || rawData.length === 0) {
            return null;
        }

        let max_stride_5p = 0;
        let max_hr_5p = 0;
        const windowSize = 5;
        
        // 5点移動平均 (Simple Moving Average)
        for (let i = 0; i <= rawData.length - windowSize; i++) {
            const window = rawData.slice(i, i + windowSize);

            // フィルタ: 窓の中の全点が有効データであること (steps>30, stride>0, hr>0)
            const isValidWindow = window.every(p => 
                (p.steps > 30) && (p.stride > 0) && (p.heartRate > 0)
            );

            if (isValidWindow) {
                const avgStride = window.reduce((sum, p) => sum + p.stride, 0) / windowSize;
                const avgHr = window.reduce((sum, p) => sum + p.heartRate, 0) / windowSize;

                if (avgStride > max_stride_5p) max_stride_5p = avgStride;
                if (avgHr > max_hr_5p) max_hr_5p = avgHr;
            }
        }

        // データが有効でなかった場合は null
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
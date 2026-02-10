const db = require('./db');
const analysisService = require('./analysis_service');

function toNumberOrZero(value) {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

/**
 * 日次サマリーを保存・更新する (Upsert)
 */
function saveDailySummary(data) {
    return new Promise((resolve, reject) => {
        const { date, max_stride, avg_stride, hr_avg, hr_max, message, avg_cadence, max_cadence, avg_speed, max_speed } = data;
        const now = new Date().toISOString();

        // Ensure omitted/invalid numeric metrics don't become unintended NULLs in SQLite.
        const safeMaxStride = toNumberOrZero(max_stride);
        const safeAvgStride = toNumberOrZero(avg_stride);
        const safeHrAvg = toNumberOrZero(hr_avg);
        const safeHrMax = toNumberOrZero(hr_max);
        const safeAvgCadence = toNumberOrZero(avg_cadence);
        const safeMaxCadence = toNumberOrZero(max_cadence);
        const safeAvgSpeed = toNumberOrZero(avg_speed);
        const safeMaxSpeed = toNumberOrZero(max_speed);

        const sql = `
            INSERT INTO daily_summary (date, max_stride, avg_stride, hr_avg, hr_max, avg_cadence, max_cadence, avg_speed, max_speed, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                max_stride = CASE WHEN excluded.max_stride > 0 THEN excluded.max_stride ELSE max_stride END,
                avg_stride = CASE WHEN excluded.avg_stride > 0 THEN excluded.avg_stride ELSE avg_stride END,
                hr_avg = CASE WHEN excluded.hr_avg > 0 THEN excluded.hr_avg ELSE hr_avg END,
                hr_max = CASE WHEN excluded.hr_max > 0 THEN excluded.hr_max ELSE hr_max END,
                avg_cadence = CASE WHEN excluded.avg_cadence > 0 THEN excluded.avg_cadence ELSE avg_cadence END,
                max_cadence = CASE WHEN excluded.max_cadence > 0 THEN excluded.max_cadence ELSE max_cadence END,
                avg_speed = CASE WHEN excluded.avg_speed > 0 THEN excluded.avg_speed ELSE avg_speed END,
                max_speed = CASE WHEN excluded.max_speed > 0 THEN excluded.max_speed ELSE max_speed END,
                message = COALESCE(excluded.message, message),
                created_at = excluded.created_at
        `;

        db.run(sql, [date, safeMaxStride, safeAvgStride, safeHrAvg, safeHrMax, safeAvgCadence, safeMaxCadence, safeAvgSpeed, safeMaxSpeed, message, now], function (err) {
            if (err) {
                console.error('Error in saveDailySummary:', err);
                return reject(err);
            }
            resolve(this.changes);
        });
    });
}

/**
 * 指定した日付のサマリーを取得する
 */
function getDailySummary(date) {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT * FROM daily_summary WHERE date = ?';
        db.get(sql, [date], (err, row) => {
            if (err) {
                console.error('Error in getDailySummary:', err);
                return reject(err);
            }
            resolve(row);
        });
    });
}

/**
 * 全てのランニングデータを取得する
 * (画像URL修正 ＆ チャートデータフォールバック機能付き)
 */
function getAllRuns() {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT 
                d.rowid as id,
                d.date,
                d.avg_stride,
                d.hr_avg,
                d.max_stride,
                d.hr_max,
                d.avg_cadence,
                d.max_cadence,
                d.avg_speed,
                d.max_speed,
                d.message,
                i.asset_id,
                i.stored_filename,
                i.original_filename
            FROM daily_summary d
            LEFT JOIN run_images r ON d.date = r.run_id
            LEFT JOIN image_assets i ON r.asset_id = i.asset_id
            ORDER BY d.date DESC, r.display_order ASC
        `;

        db.all(sql, [], (err, rows) => {
            if (err) {
                if (err.message.includes('no such table')) return resolve([]);
                return reject(err);
            }

            // 1. データを日付ごとにまとめる
            const runMap = new Map();

            rows.forEach(row => {
                if (!runMap.has(row.date)) {
                    runMap.set(row.date, {
                        id: row.id,
                        date: row.date,
                        // 数値型に変換して安全策をとる
                        avg_stride: Number(row.avg_stride || 0),
                        hr_avg: Number(row.hr_avg || 0),
                        max_stride: Number(row.max_stride || 0),
                        hr_max: Number(row.hr_max || 0),
                        avg_cadence: Number(row.avg_cadence || 0),
                        max_cadence: Number(row.max_cadence || 0),
                        avg_speed: Number(row.avg_speed || 0),
                        max_speed: Number(row.max_speed || 0),
                        message: row.message,

                        // 初期値
                        max_stride_5p: null,
                        max_hr_5p: null,

                        images: []
                    });
                }

                // 画像URL修正: "http://localhost:3000" を絶対につける
                if (row.asset_id) {
                    const run = runMap.get(row.date);
                    run.images.push({
                        id: row.asset_id,
                        // バックエンド(3000)のアセットへの絶対パス
                        url: `http://192.168.3.153:3000/assets/store/${row.stored_filename}`,
                        alt: row.original_filename || 'Run Image'
                    });
                }
            });

            // 2. vNext指標を注入（なければDB値で代用）
            const runs = Array.from(runMap.values());

            const hydratedRuns = runs.map(run => {
                // 生データから高精度計算を試みる
                const vNext = analysisService.calculateVNextMetrics(run.date);

                if (vNext) {
                    // 生データがあれば、その計算値を採用
                    return { ...run, ...vNext };
                } else {
                    // 生データがない場合、チャートが空白にならないようにDBの値を代入する
                    return {
                        ...run,
                        max_stride_5p: (run.max_stride && run.max_stride > 0) ? run.max_stride : run.avg_stride,
                        max_hr_5p: (run.hr_max && run.hr_max > 0) ? run.hr_max : run.hr_avg
                    };
                }
            });

            // デバッグ用: ターミナルにデータサンプルを表示
            if (hydratedRuns.length > 0) {
                console.log("--- DEBUG: Latest Run Data ---");
                console.log(JSON.stringify(hydratedRuns[0], null, 2));
                console.log("------------------------------");
            }

            resolve(hydratedRuns);
        });
    });
}

// ★ここが切れていないか確認してください！
/**
 * Delete a run by ID (rowid)
 */
function deleteRun(id) {
    return new Promise((resolve, reject) => {
        // 1. Get the date (run_id) first to delete linked images
        const checkSql = 'SELECT date FROM daily_summary WHERE rowid = ?';
        db.get(checkSql, [id], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(0); // Not found

            const runId = row.date;

            // 2. Delete linked images
            const deleteImagesSql = 'DELETE FROM run_images WHERE run_id = ?';
            db.run(deleteImagesSql, [runId], (err) => {
                if (err) console.error("Error deleting linked images:", err); // Log but continue

                // 3. Delete the run itself
                const deleteRunSql = 'DELETE FROM daily_summary WHERE rowid = ?';
                db.run(deleteRunSql, [id], function (err) {
                    if (err) {
                        console.error('Error in deleteRun:', err);
                        return reject(err);
                    }
                    resolve(this.changes);
                });
            });
        });
    });
}

module.exports = {
    saveDailySummary,
    getDailySummary,
    getAllRuns,
    deleteRun
};

const db = require('./db');
const analysisService = require('./analysis_service');

/**
 * 日次サマリーを保存・更新する (Upsert)
 */
function saveDailySummary(data) {
    return new Promise((resolve, reject) => {
        const { date, max_stride, avg_stride, hr_avg, hr_max, message } = data;
        const now = new Date().toISOString();

        const sql = `
            INSERT INTO daily_summary (date, max_stride, avg_stride, hr_avg, hr_max, message, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                max_stride = excluded.max_stride,
                avg_stride = excluded.avg_stride,
                hr_avg = excluded.hr_avg,
                hr_max = excluded.hr_max,
                message = excluded.message,
                created_at = excluded.created_at
        `;

        db.run(sql, [date, max_stride, avg_stride, hr_avg, hr_max, message, now], function (err) {
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
        const sql = 'DELETE FROM daily_summary WHERE rowid = ?';
        db.run(sql, [id], function (err) {
            if (err) {
                console.error('Error in deleteRun:', err);
                return reject(err);
            }
            resolve(this.changes);
        });
    });
}

module.exports = {
    saveDailySummary,
    getDailySummary,
    getAllRuns,
    deleteRun
};
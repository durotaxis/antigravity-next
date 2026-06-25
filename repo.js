const db = require('./db');
const analysisService = require('./analysis_service');
const imageRepo = require('./image_repo');

function toNumberOrZero(value) {
    if (value === null || value === undefined || value === '') return 0;
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function toPositiveNumberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
}

function toTextOrNull(value) {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}

/**
 * 日次サマリーを保存・更新する (Upsert)
 */
function saveDailySummary(data) {
    return new Promise((resolve, reject) => {
        const { date, step_count, total_distance_km, total_time, calories_kcal, max_stride, avg_stride, hr_avg, hr_max, message, avg_cadence, max_cadence, avg_speed, max_speed } = data;
        const now = new Date().toISOString();

        // Ensure omitted/invalid numeric metrics don't become unintended NULLs in SQLite.
        const safeStepCount = toNumberOrZero(step_count);
        const safeTotalDistanceKm = toNumberOrZero(total_distance_km);
        const safeCaloriesKcal = toNumberOrZero(calories_kcal);
        // Optional running metrics: keep NULL when unknown (do not force 0 on insert).
        const safeMaxStride = toPositiveNumberOrNull(max_stride);
        const safeAvgStride = toPositiveNumberOrNull(avg_stride);
        const safeHrAvg = toPositiveNumberOrNull(hr_avg);
        const safeHrMax = toPositiveNumberOrNull(hr_max);
        const safeAvgCadence = toPositiveNumberOrNull(avg_cadence);
        const safeMaxCadence = toPositiveNumberOrNull(max_cadence);
        const safeAvgSpeed = toPositiveNumberOrNull(avg_speed);
        const safeMaxSpeed = toPositiveNumberOrNull(max_speed);
        const safeTotalTime = toTextOrNull(total_time);

        const sql = `
            INSERT INTO daily_summary (
                date,
                step_count,
                total_distance_km,
                total_time,
                calories_kcal,
                max_stride,
                avg_stride,
                hr_avg,
                hr_max,
                avg_cadence,
                max_cadence,
                avg_speed,
                max_speed,
                message,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                step_count = CASE WHEN excluded.step_count > 0 THEN excluded.step_count ELSE step_count END,
                total_distance_km = CASE WHEN excluded.total_distance_km > 0 THEN excluded.total_distance_km ELSE total_distance_km END,
                total_time = COALESCE(excluded.total_time, total_time),
                calories_kcal = CASE WHEN excluded.calories_kcal > 0 THEN excluded.calories_kcal ELSE calories_kcal END,
                -- Keep peak metrics monotonic: never overwrite with a lower positive value.
                max_stride = CASE
                    WHEN excluded.max_stride > COALESCE(max_stride, 0) THEN excluded.max_stride
                    ELSE max_stride
                END,
                avg_stride = CASE WHEN excluded.avg_stride > 0 THEN excluded.avg_stride ELSE avg_stride END,
                hr_avg = CASE WHEN excluded.hr_avg > 0 THEN excluded.hr_avg ELSE hr_avg END,
                hr_max = CASE
                    WHEN excluded.hr_max > COALESCE(hr_max, 0) THEN excluded.hr_max
                    ELSE hr_max
                END,
                avg_cadence = CASE WHEN excluded.avg_cadence > 0 THEN excluded.avg_cadence ELSE avg_cadence END,
                max_cadence = CASE
                    WHEN excluded.max_cadence > COALESCE(max_cadence, 0) THEN excluded.max_cadence
                    ELSE max_cadence
                END,
                avg_speed = CASE WHEN excluded.avg_speed > 0 THEN excluded.avg_speed ELSE avg_speed END,
                max_speed = CASE
                    WHEN excluded.max_speed > COALESCE(max_speed, 0) THEN excluded.max_speed
                    ELSE max_speed
                END,
                message = COALESCE(excluded.message, message),
                created_at = excluded.created_at
        `;

        db.run(sql, [date, safeStepCount, safeTotalDistanceKm, safeTotalTime, safeCaloriesKcal, safeMaxStride, safeAvgStride, safeHrAvg, safeHrMax, safeAvgCadence, safeMaxCadence, safeAvgSpeed, safeMaxSpeed, message, now], function (err) {
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
                d.step_count,
                d.total_distance_km,
                d.total_time,
                d.calories_kcal,
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
                        step_count: Number(row.step_count || 0),
                        total_distance_km: Number(row.total_distance_km || 0),
                        total_time: row.total_time || null,
                        calories_kcal: Number(row.calories_kcal || 0),
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
                        url: `/assets/store/${row.stored_filename}`,
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
            resolve(hydratedRuns);
        });
    });
}

// ★ここが切れていないか確認してください！
/**
 * Delete a run by ID (rowid)
 */
function deleteRunByDate(date, options = {}) {
    return (async () => {
        if (!date) return 0;
        const runId = date;
        const removeAssets = !(options && options.removeAssets === false);

        const all = (sql, params = []) => new Promise((resolve, reject) => {
            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });

        const get = (sql, params = []) => new Promise((resolve, reject) => {
            db.get(sql, params, (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });

        const run = (sql, params = []) => new Promise((resolve, reject) => {
            db.run(sql, params, function (err) {
                if (err) return reject(err);
                resolve(this.changes || 0);
            });
        });

        const assetRows = await all('SELECT asset_id FROM run_images WHERE run_id = ?', [runId]);
        await run('DELETE FROM run_images WHERE run_id = ?', [runId]);
        await run('DELETE FROM run_messages WHERE date = ?', [runId]);
        const changes = await run('DELETE FROM daily_summary WHERE date = ?', [runId]);

        if (removeAssets) {
            // Clean up orphaned assets + files
            for (const row of assetRows) {
                const assetId = row.asset_id;
                if (!assetId) continue;
                const hasOtherLink = await get('SELECT 1 AS ok FROM run_images WHERE asset_id = ? LIMIT 1', [assetId]);
                if (!hasOtherLink) {
                    try { await imageRepo.deleteAssetWithFile(assetId); } catch (e) {
                        console.error('Error deleting orphaned asset:', e.message || e);
                    }
                }
            }
        }

        return changes;
    })();
}

function saveRunMessage(data) {
    return new Promise((resolve, reject) => {
        const date = toTextOrNull(data && data.date);
        const runId = toTextOrNull(data && data.run_id);
        const message = toTextOrNull(data && data.message);
        const now = new Date().toISOString();

        if (!date || !runId || !message) {
            return reject(new Error('date, run_id, and message are required'));
        }

        const sql = `
            INSERT INTO run_messages (
                date,
                run_id,
                message,
                created_at
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(date, run_id) DO UPDATE SET
                message = excluded.message,
                created_at = excluded.created_at
        `;

        db.run(sql, [date, runId, message, now], function (err) {
            if (err) {
                console.error('Error in saveRunMessage:', err);
                return reject(err);
            }
            resolve(this.changes);
        });
    });
}

function getRunMessage(date, runId) {
    return new Promise((resolve, reject) => {
        const normalizedDate = toTextOrNull(date);
        const normalizedRunId = toTextOrNull(runId);
        if (!normalizedDate || !normalizedRunId) {
            return resolve(null);
        }

        const sql = 'SELECT date, run_id, message, created_at FROM run_messages WHERE date = ? AND run_id = ?';
        db.get(sql, [normalizedDate, normalizedRunId], (err, row) => {
            if (err) {
                console.error('Error in getRunMessage:', err);
                return reject(err);
            }
            resolve(row || null);
        });
    });
}

function saveDailySummaryExact(data) {
    return new Promise((resolve, reject) => {
        const { date, step_count, total_distance_km, total_time, calories_kcal, max_stride, avg_stride, hr_avg, hr_max, message, avg_cadence, max_cadence, avg_speed, max_speed } = data;
        const now = new Date().toISOString();

        const safeStepCount = toNumberOrZero(step_count);
        const safeTotalDistanceKm = toNumberOrZero(total_distance_km);
        const safeCaloriesKcal = toNumberOrZero(calories_kcal);
        const safeMaxStride = toPositiveNumberOrNull(max_stride);
        const safeAvgStride = toPositiveNumberOrNull(avg_stride);
        const safeHrAvg = toPositiveNumberOrNull(hr_avg);
        const safeHrMax = toPositiveNumberOrNull(hr_max);
        const safeAvgCadence = toPositiveNumberOrNull(avg_cadence);
        const safeMaxCadence = toPositiveNumberOrNull(max_cadence);
        const safeAvgSpeed = toPositiveNumberOrNull(avg_speed);
        const safeMaxSpeed = toPositiveNumberOrNull(max_speed);
        const safeTotalTime = toTextOrNull(total_time);
        const safeMessage = toTextOrNull(message);

        const sql = `
            INSERT INTO daily_summary (
                date,
                step_count,
                total_distance_km,
                total_time,
                calories_kcal,
                max_stride,
                avg_stride,
                hr_avg,
                hr_max,
                avg_cadence,
                max_cadence,
                avg_speed,
                max_speed,
                message,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                step_count = excluded.step_count,
                total_distance_km = excluded.total_distance_km,
                total_time = excluded.total_time,
                calories_kcal = excluded.calories_kcal,
                max_stride = excluded.max_stride,
                avg_stride = excluded.avg_stride,
                hr_avg = excluded.hr_avg,
                hr_max = excluded.hr_max,
                avg_cadence = excluded.avg_cadence,
                max_cadence = excluded.max_cadence,
                avg_speed = excluded.avg_speed,
                max_speed = excluded.max_speed,
                message = COALESCE(excluded.message, message),
                created_at = excluded.created_at
        `;

        db.run(sql, [date, safeStepCount, safeTotalDistanceKm, safeTotalTime, safeCaloriesKcal, safeMaxStride, safeAvgStride, safeHrAvg, safeHrMax, safeAvgCadence, safeMaxCadence, safeAvgSpeed, safeMaxSpeed, safeMessage, now], function (err) {
            if (err) {
                console.error('Error in saveDailySummaryExact:', err);
                return reject(err);
            }
            resolve(this.changes);
        });
    });
}

function deleteRun(idOrDate, options = {}) {
    return new Promise((resolve, reject) => {
        const idStr = String(idOrDate ?? '').trim();
        if (!idStr) return resolve(0);

        const idNum = Number(idStr);
        const isRowId = Number.isFinite(idNum) && idNum > 0 && String(idNum) === idStr;

        if (!isRowId) {
            return deleteRunByDate(idStr, options).then(resolve, reject);
        }

        // 1. Get the date (run_id) first to delete linked images
        const checkSql = 'SELECT date FROM daily_summary WHERE rowid = ?';
        db.get(checkSql, [idNum], (err, row) => {
            if (err) return reject(err);
            if (!row) {
                // Fallback: treat id as date if rowid lookup failed
                return deleteRunByDate(idStr, options).then(resolve, reject);
            }

            // Delegate to date-based delete to ensure orphan cleanup.
            deleteRunByDate(row.date, options).then(resolve, reject);
        });
    });
}

module.exports = {
    saveDailySummary,
    saveDailySummaryExact,
    saveRunMessage,
    getRunMessage,
    getDailySummary,
    getAllRuns,
    deleteRun
};

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const imageRepo = require('./image_repo');
const repo = require('./repo');
const googleFitService = require('./google_fit_service');
const geminiService = require('./gemini_service');

const INBOX_DIR = path.join(__dirname, 'Phone Link');
const STORE_DIR = path.join(__dirname, 'public/assets/store');

/**
 * Calculate SHA256 hash of a file
 */
async function getFileHash(filePath) {
    const fileBuffer = await fs.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

/**
 * Parse date from filename (e.g., "Screenshot_20260124-190513.png")
 * Returns YYYY-MM-DD or null
 */
// Deprecated: unused in current ingest flow.
function extractDateFromFilename(filename) {
    const raw = String(filename || '');
    const text = raw
        .replace(/[・ｽE・ｽE・ｽE・ｽ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
        .replace(/\s+/g, '');

    // 1) YYYYMMDD / YYYY-MM-DD / YYYY_MM_DD
    let match = text.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
    if (match) {
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return date;
        }
    }

    // 2) Japanese style without year: 10譛・8譌･ / 10-28 / 10_28
    match = text.match(/(\d{1,2})(?:譛・[^\d]{1,3})(\d{1,2})(?:譌･)?/);
    if (match) {
        const month = Number(match[1]);
        const day = Number(match[2]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const now = new Date();
            const y = month > (now.getMonth() + 1) ? (now.getFullYear() - 1) : now.getFullYear();
            const date = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return date;
        }
    }

    // 3) DD-MM-YYYY / DD_MM_YYYY
    match = text.match(/(\d{1,2})[-_](\d{1,2})[-_](\d{4})/);
    if (match) {
        const day = Number(match[1]);
        const month = Number(match[2]);
        const year = Number(match[3]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            return date;
        }
    }

    return null;
}

/**
 * Import all images from Inbox to Store
 */
async function importFromInbox() {
    try {
        const files = await fs.readdir(INBOX_DIR);
        const results = [];


        for (const file of files) {
            if (file.startsWith('.')) continue; // skip hidden files

            const inboxPath = path.join(INBOX_DIR, file);
            const fileStats = await fs.stat(inboxPath);

            if (!fileStats.isFile()) continue;


            // 1. Calculate Hash
            const hash = await getFileHash(inboxPath);
            const ext = path.extname(file).toLowerCase();
            const storedFilename = `${hash}${ext}`;
            const storePath = path.join(STORE_DIR, storedFilename);

            // 2. Check DB for existing asset
            let asset = await imageRepo.findAssetByHash(hash);

            if (!asset) {
                // New Asset: Copy to store and create DB record
                // We use copyFile instead of rename to keep inbox intact for safety until confirmed (can be changed to rename)
                // User requested "Inbox is Read-Only" in prompt details? 
                // -> "INBOX_DIR: 繝ｦ繝ｼ繧ｶ繝ｼ縺檎判蜒上ｒ謇句虚縺ｧ謚包ｿｽE縺吶ｋ繝輔か繝ｫ繝・ｽE・ｽ繧ｷ繧ｹ繝・・ｽ・ｽ縺ｯRead-Only・ｽE・ｽE
                // Wait, if system is Read-only for Inbox, we CANNOT delete/move files. 
                // Implementation Plan said "Delete from inbox (or archive)".
                // Let's CLARIFY: "System is Read-Only" usually means system doesn't mess with user's files?
                // But "Inbox" pattern usually implies consumption. 
                // I will COPY for now to respect "Read-Only" constraint literally.

                // Actually, if it's read-only, we just copy.
                await fs.copyFile(inboxPath, storePath);
                const assetId = await imageRepo.createAsset(hash, storedFilename, file);
                asset = { asset_id: assetId, file_hash: hash };
            } else {
            }

            // 3. Link to Run (Skipping filename-based linking per user request)
            const linked = false;
            const date = null;

            results.push({ file, hash, linked, date });
        }

        return results;

    } catch (err) {
        console.error('Import failed:', err);
        throw err;
    }
}

/**
 * Get list of files in Inbox
 */
async function getInboxFiles() {
    try {
        const files = await fs.readdir(INBOX_DIR);
        // Filter only image files if needed, for now just skip hidden
        return files.filter(f => !f.startsWith('.'));
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

/**
 * Import specific selected files from Inbox to Store and link to runId
 */
async function importSelectedFiles(filenames, runId, options = {}) {
    const skipAdvice = options && options.skipAdvice === true;
    const skipSummary = options && options.skipSummary === true;
    const results = [];
    for (const file of filenames) {
        try {
            const inboxPath = path.join(INBOX_DIR, file);

            // Check if file exists
            try {
                await fs.access(inboxPath);
            } catch {
                console.warn(`File not found in inbox: ${file}`);
                results.push({ file, status: 'error', error: 'File not found' });
                continue;
            }

            // 1. Calculate Hash
            const hash = await getFileHash(inboxPath);
            const ext = path.extname(file).toLowerCase();
            const storedFilename = `${hash}${ext}`;
            const storePath = path.join(STORE_DIR, storedFilename);

            // 2. Check/Create Asset
            let asset = await imageRepo.findAssetByHash(hash);

            if (!asset) {
                // Copy to store (idempotent)
                await fs.copyFile(inboxPath, storePath);
                const assetId = await imageRepo.createAsset(hash, storedFilename, file);
                asset = { asset_id: assetId, file_hash: hash };
            }

            // 3. Link to Run
            await imageRepo.linkImageToRun(runId, asset.asset_id);

            // Auto-create or sync Daily Summary (for Selected Import)
            // runId is the date string here
            if (!skipSummary) {
            try {
                const existingSummary = await repo.getDailySummary(runId);
                const needsSpeedSync =
                    !existingSummary ||
                    !(Number(existingSummary.avg_speed) > 0) ||
                    !(Number(existingSummary.max_speed) > 0);

                if (!existingSummary || needsSpeedSync) {
                    // Ensure intraday cache exists before metric aggregation
                    try {
                        const cacheDir = path.join(__dirname, 'storage', 'cache');
                        const rawCacheFile = path.join(cacheDir, `raw_buckets_${runId}.json`);
                        const intradayCacheFile = path.join(cacheDir, `intraday_${runId}.json`);

                        let hasRaw = true;
                        let hasIntraday = true;
                        try { await fs.access(rawCacheFile); } catch { hasRaw = false; }
                        try { await fs.access(intradayCacheFile); } catch { hasIntraday = false; }

                        if (!hasRaw || !hasIntraday) {
                            await googleFitService.getIntradayMetrics(runId);
                        }
                    } catch (cacheErr) {
                        console.warn(`  -> Cache build failed for ${runId}: ${cacheErr.message}`);
                    }

                    const fitData = await googleFitService.getDailyMetrics(runId);
                    const intradayData = await googleFitService.getIntradayMetrics(runId);

                    let intradayAvgSpeed = 0;
                    let intradayMaxSpeed = 0;
                    let intradayAvgStride = 0;
                    let intradayMaxStride = 0;
                    if (Array.isArray(intradayData) && intradayData.length > 0) {
                        let sumSpeed = 0;
                        let countSpeed = 0;
                        let sumStride = 0;
                        let countStride = 0;
                        for (const p of intradayData) {
                            const speed = Number(p && p.speed);
                            if (Number.isFinite(speed) && speed > 0) {
                                sumSpeed += speed;
                                countSpeed += 1;
                                if (speed > intradayMaxSpeed) intradayMaxSpeed = speed;
                            }

                            const stride = Number(p && p.stride);
                            if (Number.isFinite(stride) && stride > 0 && stride <= 250) {
                                sumStride += stride;
                                countStride += 1;
                                if (stride > intradayMaxStride) intradayMaxStride = stride;
                            }
                        }
                        if (countSpeed > 0) intradayAvgSpeed = Number((sumSpeed / countSpeed).toFixed(1));
                        if (intradayMaxSpeed > 0) intradayMaxSpeed = Number(intradayMaxSpeed.toFixed(1));
                        if (countStride > 0) intradayAvgStride = Number((sumStride / countStride).toFixed(1));
                        if (intradayMaxStride > 0) intradayMaxStride = Number(intradayMaxStride.toFixed(1));
                    }

                    if (fitData && fitData.step_count > 0) {
                        const advice = existingSummary
                            ? existingSummary.message
                            : (skipAdvice ? null : await geminiService.generateAdvice(fitData));

                        const finalAvgSpeed = intradayAvgSpeed > 0 ? intradayAvgSpeed : 0;
                        const finalMaxSpeed = Number(fitData.max_speed) > 0
                            ? Number(fitData.max_speed)
                            : intradayMaxSpeed;
                        const finalAvgStride = intradayAvgStride > 0
                            ? intradayAvgStride
                            : (Number(fitData.avg_stride_cm) > 0 ? Number(fitData.avg_stride_cm) : 0);
                        const finalMaxStride = intradayMaxStride > 0
                            ? intradayMaxStride
                            : (Number(fitData.max_stride_cm) > 0 ? Number(fitData.max_stride_cm) : 0);

                        const summaryData = {
                            date: fitData.date || runId,
                            step_count: fitData.step_count,
                            total_distance_km: fitData.total_distance_km,
                            total_time: fitData.total_time,
                            calories_kcal: fitData.calories_kcal,
                            max_stride: finalMaxStride,
                            avg_stride: finalAvgStride,
                            hr_avg: fitData.avg_heart_rate,
                            hr_max: fitData.max_heart_rate,
                            avg_cadence: fitData.avg_cadence,
                            max_cadence: fitData.max_cadence,
                            avg_speed: finalAvgSpeed,
                            max_speed: finalMaxSpeed,
                            message: advice
                        };

                        await repo.saveDailySummary(summaryData);
                    }
                }
            } catch (summErr) {
                console.error('  -> Failed to auto-create summary:', summErr.message);
            }

            }
            results.push({ file, hash, status: 'success' });

        } catch (err) {
            console.error(`Failed to import ${file}:`, err);
            results.push({ file, status: 'error', error: err.message });
        }
    }

    return results;
}
module.exports = {
    importFromInbox,
    getInboxFiles,
    importSelectedFiles,
    // extractDateFromFilename,
    INBOX_DIR // Exporting for direct file serving if needed
};





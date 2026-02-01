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
function extractDateFromFilename(filename) {
    // Regex for "20260124" or "2026-01-24" or "2026_01_24"
    // Try YYYY[-_]?MM[-_]?DD
    const match = filename.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
    if (match) {
        const date = `${match[1]}-${match[2]}-${match[3]}`;
        console.log(`[ImageService] Extracted Date from ${filename}: ${date}`);
        return date;
    }
    console.log(`[ImageService] Failed to extract date from ${filename}`);
    return null;
}

/**
 * Import all images from Inbox to Store
 */
async function importFromInbox() {
    try {
        const files = await fs.readdir(INBOX_DIR);
        const results = [];

        console.log(`Scanning Inbox: ${INBOX_DIR}`);

        for (const file of files) {
            if (file.startsWith('.')) continue; // skip hidden files

            const inboxPath = path.join(INBOX_DIR, file);
            const fileStats = await fs.stat(inboxPath);

            if (!fileStats.isFile()) continue;

            console.log(`Processing: ${file}`);

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
                // -> "INBOX_DIR: ユーザーが画像を手動で投入するフォルダ（システムはRead-Only）"
                // Wait, if system is Read-only for Inbox, we CANNOT delete/move files. 
                // Implementation Plan said "Delete from inbox (or archive)".
                // Let's CLARIFY: "System is Read-Only" usually means system doesn't mess with user's files?
                // But "Inbox" pattern usually implies consumption. 
                // I will COPY for now to respect "Read-Only" constraint literally.

                // Actually, if it's read-only, we just copy.
                await fs.copyFile(inboxPath, storePath);
                const assetId = await imageRepo.createAsset(hash, storedFilename, file);
                asset = { asset_id: assetId, file_hash: hash };
                console.log(`  -> New Asset Created: ${assetId}`);
            } else {
                console.log(`  -> Duplicate Asset Found: ${asset.asset_id}`);
            }

            // 3. Link to Run (if date found)
            const date = extractDateFromFilename(file);
            let linked = false;
            if (date) {
                await imageRepo.linkImageToRun(date, asset.asset_id);
                console.log(`  -> Linked to Run: ${date}`);
                linked = true;

                // ★ Auto-create Daily Summary if missing
                try {
                    const existingSummary = await repo.getDailySummary(date);
                    if (!existingSummary) {
                        console.log(`  -> No Daily Summary for ${date}. Fetching from Google Fit...`);
                        const fitData = await googleFitService.getDailyMetrics(date);

                        if (fitData && fitData.step_count > 0) {
                            console.log(`  -> Fit Data Found: ${fitData.step_count} steps. Generating Advice...`);
                            const advice = await geminiService.generateAdvice(fitData);

                            const summaryData = {
                                date: fitData.date,
                                max_stride: fitData.max_stride_cm,
                                avg_stride: fitData.avg_stride_cm,
                                hr_avg: fitData.avg_heart_rate,
                                hr_max: fitData.max_heart_rate,
                                message: advice
                            };

                            await repo.saveDailySummary(summaryData);
                            console.log(`  -> ✨ Daily Summary Auto-created with AI Advice!`);
                        } else {
                            console.log(`  -> No valid Fit data found for ${date}. Skipping summary creation.`);
                        }
                    }
                } catch (summErr) {
                    console.error('  -> Failed to auto-create summary:', summErr.message);
                }
            }

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
async function importSelectedFiles(filenames, runId) {
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

            console.log(`Importing selected: ${file} for Run: ${runId}`);

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
                console.log(`  -> New Asset Created: ${assetId}`);
            }

            // 3. Link to Run
            await imageRepo.linkImageToRun(runId, asset.asset_id);
            console.log(`  -> Linked to Run: ${runId}`);

            // ★ Auto-create Daily Summary if missing (for Selected Import)
            // runId is the date string here
            try {
                const existingSummary = await repo.getDailySummary(runId);
                if (!existingSummary) {
                    console.log(`  -> No Daily Summary for ${runId}. Fetching from Google Fit...`);
                    const fitData = await googleFitService.getDailyMetrics(runId);

                    if (fitData && fitData.step_count > 0) {
                        console.log(`  -> Fit Data Found: ${fitData.step_count} steps. Generating Advice...`);
                        const advice = await geminiService.generateAdvice(fitData);

                        const summaryData = {
                            date: fitData.date,
                            max_stride: fitData.max_stride_cm,
                            avg_stride: fitData.avg_stride_cm,
                            hr_avg: fitData.avg_heart_rate,
                            hr_max: fitData.max_heart_rate,
                            message: advice
                        };

                        await repo.saveDailySummary(summaryData);
                        console.log(`  -> ✨ Daily Summary Auto-created with AI Advice!`);
                    }
                }
            } catch (summErr) {
                console.error('  -> Failed to auto-create summary:', summErr.message);
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
    extractDateFromFilename,
    INBOX_DIR // Exporting for direct file serving if needed
};

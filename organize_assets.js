const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const imageRepo = require('./image_repo');
const imageService = require('./image_service');

// Configuration
const SOURCE_DIRS = [
    path.join(__dirname, 'Phone Link'), // Inbox
    __dirname // Root for stray screenshots
];
const STORE_DIR = path.join(__dirname, 'public/assets/store');

async function getFileHash(filePath) {
    const fileBuffer = await fs.readFile(filePath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);
    return hashSum.digest('hex');
}

async function organizeAssets() {
    console.log('📦 Starting Asset Organization...');
    console.log(`Target Store: ${STORE_DIR}`);

    // Ensure store exists
    try {
        await fs.mkdir(STORE_DIR, { recursive: true });
    } catch (e) { }

    let processedCount = 0;
    let errorCount = 0;

    for (const sourceDir of SOURCE_DIRS) {
        console.log(`\n📂 Scanning: ${sourceDir}`);
        try {
            const files = await fs.readdir(sourceDir);

            for (const file of files) {
                // Filter Logic
                if (file.toLowerCase().endsWith('.desktop') || file.toLowerCase().endsWith('.ini')) continue;
                if (file.startsWith('.')) continue; // skip hidden

                // Allow PNG/JPG/JPEG/WEBP
                const ext = path.extname(file).toLowerCase();
                if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) continue;

                // Specifically look for "Screenshot" or similar if scanning root to avoid moving unrelated stuff
                if (sourceDir === __dirname && !file.includes('Screenshot') && !file.includes('スクリーンショット')) {
                    continue;
                }

                const sourcePath = path.join(sourceDir, file);

                // Skip directories
                try {
                    const stats = await fs.stat(sourcePath);
                    if (!stats.isFile()) continue;
                } catch (e) { continue; }

                console.log(`  Processing: ${file}`);

                try {
                    // 1. Calculate Hash
                    const hash = await getFileHash(sourcePath);
                    const storedFilename = `${hash}${ext}`;
                    const targetPath = path.join(STORE_DIR, storedFilename);

                    // 2. Copy to Store (Idempotent)
                    // We use copy instead of move to be safe, or should we move?
                    // User said "move/consolidate". 
                    // Let's COPY first. If we move from root we might break something if user keeps it there.
                    // But for "Phone Link" (Inbox), consumption usually implies moving. 
                    // However, `image_service.js` copies. I will COPY to be safe.
                    await fs.copyFile(sourcePath, targetPath);

                    // 3. Register in DB
                    let asset = await imageRepo.findAssetByHash(hash);
                    if (!asset) {
                        const assetId = await imageRepo.createAsset(hash, storedFilename, file);
                        console.log(`    -> ✅ Imported as New Asset (ID: ${assetId})`);
                        asset = { asset_id: assetId };
                    } else {
                        console.log(`    -> ♻️  Asset already exists (ID: ${asset.asset_id})`);
                    }

                    // 4. Link to Run if possible (using existing logic)
                    // If date is parseable
                    let date = imageService.extractDateFromFilename(file);
                    // Handle Japanese format in root if needed? "スクリーンショット_26-1-2026..."
                    if (!date && file.startsWith('スクリーンショット')) {
                        // "スクリーンショット_26-1-2026_194352..." -> 26-1-2026 -> 2026-01-26
                        // regex: _(\d{1,2})-(\d{1,2})-(\d{4})_
                        const match = file.match(/_(\d{1,2})-(\d{1,2})-(\d{4})_/);
                        if (match) {
                            const [_, d, m, y] = match;
                            date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
                        }
                    }

                    if (date) {
                        await imageRepo.linkImageToRun(date, asset.asset_id);
                        console.log(`    -> 🔗 Linked to Run Date: ${date}`);
                    }

                    processedCount++;

                } catch (err) {
                    console.error(`    ❌ Error processing ${file}:`, err.message);
                    errorCount++;
                }
            }

        } catch (err) {
            console.error(`Error reading dir ${sourceDir}:`, err);
        }
    }

    console.log(`\n✨ Organization Complete.`);
    console.log(`Processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
}

organizeAssets();

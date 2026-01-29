const fs = require('fs').promises;
const path = require('path');
const db = require('./db');

const STORE_DIR = path.join(__dirname, 'public/assets/store');

async function verifyAssets() {
    console.log('🔍 Verifying Assets Integrity...');

    // Get all assets from DB
    const assets = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM image_assets', [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    console.log(`DB referenced assets: ${assets.length}`);

    let missingCount = 0;

    for (const asset of assets) {
        const filePath = path.join(STORE_DIR, asset.stored_filename);
        try {
            await fs.access(filePath);
            // console.log(`  ✅ Found: ${asset.stored_filename}`);
        } catch (e) {
            console.error(`  ❌ MISSING: ${asset.stored_filename} (ID: ${asset.asset_id})`);
            missingCount++;
        }
    }

    if (missingCount === 0) {
        console.log('\n✅ All DB assets exist on disk.');
    } else {
        console.error(`\n❌ Validation Failed: ${missingCount} assets missing.`);
        process.exit(1);
    }
}

verifyAssets();

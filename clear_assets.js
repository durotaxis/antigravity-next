const fs = require('fs').promises;
const path = require('path');
const db = require('./db');

const STORE_DIR = path.join(__dirname, 'public/assets/store');

async function clearAssets() {
    console.log('🗑️  Starting Asset Cleanup...');

    // 1. Clear Database Tables
    console.log('1. Clearing Database Tables...');
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run("DELETE FROM run_images", (err) => {
                if (err) console.error('Error clearing run_images:', err);
                else console.log('   - Cleared run_images table');
            });
            db.run("DELETE FROM image_assets", (err) => {
                if (err) return reject(err);
                console.log('   - Cleared image_assets table');
                resolve();
            });
        });
    });

    // 2. Clear File System
    console.log('2. Clearing File System...');
    try {
        const files = await fs.readdir(STORE_DIR);
        for (const file of files) {
            if (file === '.gitkeep') continue; // Preserve .gitkeep if it exists
            const filePath = path.join(STORE_DIR, file);
            await fs.unlink(filePath);
            console.log(`   - Deleted: ${file}`);
        }
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.error('Error clearing directory:', err);
        } else {
            console.log('   - Directory not found or empty.');
        }
    }

    console.log('✨ Cleanup Complete!');
}

clearAssets().catch(console.error).finally(() => {
    // Close DB connection after a short delay to allow pending ops (though serialize handles it mostly)
    setTimeout(() => {
        db.close();
    }, 1000);
});

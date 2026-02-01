const axios = require('axios');
const db = require('./db');

// Configuration
const BASE_URL = 'http://localhost:3000';
const TEST_DATE = '2025-11-01'; // Use a date we know exists or can create
const TEST_IMAGE_HASH = 'test_hash_delete';

async function runTest() {
    console.log('--- Testing DELETE Image Endpoint ---');

    console.log('1. Setup: Creating dummy asset and link...');
    // Create dummy asset
    const assetId = await new Promise((resolve, reject) => {
        db.run(`INSERT INTO image_assets (file_hash, stored_filename, original_filename) VALUES (?, ?, ?)`,
            [TEST_IMAGE_HASH, 'delete_test.png', 'delete_test.png'],
            function (err) { if (err) reject(err); else resolve(this.lastID); }
        );
    });
    console.log(`   Dummy Asset Created: ID ${assetId}`);

    // Link to Run
    await new Promise((resolve, reject) => {
        db.run(`INSERT INTO run_images (run_id, asset_id) VALUES (?, ?)`,
            [TEST_DATE, assetId],
            function (err) { if (err) reject(err); else resolve(); }
        );
    });
    console.log(`   Linked to Run: ${TEST_DATE}`);

    console.log('2. Verifying Link Exists...');
    const linkExists = await new Promise((resolve) => {
        db.get(`SELECT * FROM run_images WHERE run_id = ? AND asset_id = ?`, [TEST_DATE, assetId], (err, row) => resolve(!!row));
    });
    if (!linkExists) {
        console.error('FAILED: Setup failed, link not found.');
        return;
    }
    console.log('   Link Verified.');

    console.log('3. Action: Calling DELETE endpoint...');
    try {
        const res = await axios.delete(`${BASE_URL}/api/runs/${TEST_DATE}/images/${assetId}`);
        console.log(`   API Status: ${res.status}`);
        console.log(`   API Response:`, res.data);

        if (res.data.success) {
            console.log('   API reported success.');
        } else {
            console.error('   API reported failure.');
        }

    } catch (err) {
        console.error('   API Request Failed:', err.message);
        if (err.response) console.error('   Response:', err.response.data);
    }

    console.log('4. Verification: Checking DB...');
    const linkStillExists = await new Promise((resolve) => {
        db.get(`SELECT * FROM run_images WHERE run_id = ? AND asset_id = ?`, [TEST_DATE, assetId], (err, row) => resolve(!!row));
    });

    if (!linkStillExists) {
        console.log('PASSED: Link was removed from DB.');
    } else {
        console.error('FAILED: Link still exists in DB!');
    }

    console.log('5. Cleanup (optional)...');
    // Remove the dummy asset
    db.run(`DELETE FROM image_assets WHERE asset_id = ?`, [assetId]);
}

runTest();

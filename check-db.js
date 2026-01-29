const repo = require('./repo');
const fs = require('fs');
const path = require('path');

async function test() {
    console.log('--- Testing DB Ops ---');

    const testData = {
        date: '2025-01-01',
        max_stride: 150.5,
        avg_stride: 120.3,
        hr_avg: 130,
        hr_max: 160,
        message: 'Test Message'
    };

    try {
        // 1. Save
        console.log('Saving...');
        await repo.saveDailySummary(testData);
        console.log('Saved.');

        // 2. Get
        console.log('Retrieving...');
        const result = await repo.getDailySummary('2025-01-01');
        console.log('Got:', result);

        if (result.message === 'Test Message' && result.max_stride === 150.5) {
            console.log('SUCCESS: Data matches.');
        } else {
            console.error('FAILURE: Data mismatch.');
            process.exit(1);
        }

        // 3. Update (Upsert)
        console.log('Updating...');
        testData.message = 'Updated Message';
        await repo.saveDailySummary(testData);

        const result2 = await repo.getDailySummary('2025-01-01');
        console.log('Got updated:', result2);

        if (result2.message === 'Updated Message') {
            console.log('SUCCESS: Update worked.');
        } else {
            console.error('FAILURE: Update failed.');
            process.exit(1);
        }

    } catch (err) {
        console.error('ERROR:', err);
        process.exit(1);
    }
}

test();

const googleFitService = require('./google_fit_service');
const repo = require('./repo');
const fs = require('fs');
const path = require('path');

// Mock Express-like environment if needed, or just run directly
async function recalculate() {
    console.log("Starting DB Recalculation...");

    try {
        const runs = await repo.getAllRuns();
        console.log(`Found ${runs.length} runs to process.`);

        for (const run of runs) {
            console.log(`Processing ${run.date}...`);
            try {
                // Fetch Metrics (Uses Cache + New Filters + New SMA Logic)
                const metrics = await googleFitService.getDailyMetrics(run.date);

                // Construct object for saving
                // Note: repo.saveDailySummary expects: { date, max_stride, avg_stride, hr_avg, hr_max, message }
                // We keep the existing message to avoid overwriting AI advice with nothing
                const dataToSave = {
                    date: metrics.date,
                    max_stride: metrics.max_stride_cm, // New Logic Value
                    avg_stride: metrics.avg_stride_cm,
                    hr_avg: metrics.avg_heart_rate,
                    hr_max: metrics.max_heart_rate,    // New Logic Value
                    message: run.message // Preserve existing message
                };

                await repo.saveDailySummary(dataToSave);
                console.log(`  -> Updated: Max Stride=${metrics.max_stride_cm}, Max HR=${metrics.max_heart_rate}`);
            } catch (err) {
                console.error(`  -> Failed for ${run.date}:`, err.message);
            }
        }
        console.log("Recalculation Complete.");
    } catch (err) {
        console.error("Fatal Error:", err);
    }
}

recalculate();

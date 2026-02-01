const service = require('./google_fit_service');
const repo = require('./repo');

async function proveIt() {
    const date = '2026-01-16';
    console.log(`fetching Google Fit data for ${date}...`);
    try {
        const data = await service.getDailyMetrics(date);
        console.log('--- FETCHED DATA ---');
        console.log(`Max Stride (Calc): ${data.max_stride_cm} cm`);
        console.log(`Max HR (Raw): ${data.max_heart_rate} bpm`);
        console.log('--------------------');

        if (data.max_stride_cm > 150 && data.max_heart_rate > 0) {
            console.log("SUCCESS: Data is available and matches expectations.");
            console.log("If you delete the DB record, this data will be re-saved.");
        } else {
            console.log("WARNING: Data seems low/missing.");
        }
    } catch (e) {
        console.error("FAILED:", e);
    }
}

proveIt();

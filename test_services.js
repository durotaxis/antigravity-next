const googleFitService = require('./google_fit_service');
const geminiService = require('./gemini_service');

async function test() {
    console.log('--- Testing Google Fit Service ---');
    try {
        // Use a recent date, e.g., yesterday or today
        // Adjust this date if needed to one that likely has data
        const testDate = '2026-01-24';
        let metrics = null;
        try {
            console.log(`Fetching metrics for ${testDate}...`);
            metrics = await googleFitService.getDailyMetrics(testDate);
            console.log('Metrics:', metrics);
        } catch (e) {
            console.error('Fit Service failed (expected if token expired):', e.message);
        }

        if (metrics) {
            console.log('\n--- Testing Gemini Service with FIT Data ---');
            console.log('Generating advice...');
            const advice = await geminiService.generateAdvice(metrics);
            console.log('Advice:', advice);
        } else {
            console.log('Testing with dummy metrics...');
            const dummy = {
                date: '2026-01-01',
                step_count: 5000,
                total_distance_km: 3.5,
                calories_kcal: 300,
                avg_stride_cm: 70.0,
                avg_heart_rate: 140
            };
            const advice = await geminiService.generateAdvice(dummy);
            console.log('Dummy Advice:', advice);
        }

    } catch (err) {
        console.error('Test Failed:', err);
    }
}

test();

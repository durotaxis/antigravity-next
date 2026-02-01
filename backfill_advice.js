const db = require('./db');
const geminiService = require('./gemini_service');
const repo = require('./repo');

async function backfill() {
    console.log('Starting Advice Backfill...');

    // Find records with missing messages or empty messages
    const sql = "SELECT * FROM daily_summary WHERE message IS NULL OR message = ''";

    db.all(sql, [], async (err, rows) => {
        if (err) {
            console.error('DB Error:', err);
            return;
        }

        console.log(`Found ${rows.length} records needing advice.`);

        for (const row of rows) {
            console.log(`Processing ${row.date}...`);

            // Construct metrics object for Gemini
            // We use existing DB data. 
            // Note: DB doesn't store 'steps' directly in daily_summary!
            // Wait, daily_summary schema has: date, max_stride, avg_stride, hr_avg, hr_max, message
            // It does NOT have steps, distance, calories explicitly in the summary table unless added previously.
            // Let's check schema again. 
            // If steps are missing, the advice might be generic, but we have Stride & HR which are most important for the prompt.

            const metrics = {
                date: row.date,
                step_count: "Unknown", // daily_summary table doesn't have steps column based on previous `repo.js` view
                total_distance_km: "Unknown",
                calories_kcal: "Unknown",
                avg_stride_cm: row.avg_stride,
                avg_heart_rate: row.hr_avg
            };

            // Try to find steps from image_assets if possible?
            // Too complex for now. Let's ask Gemini to give advice based on Stride & HR found.

            try {
                const advice = await geminiService.generateAdvice(metrics);
                console.log(`  -> Generated: ${advice.substring(0, 20)}...`);

                // Update DB
                await new Promise((resolve, reject) => {
                    db.run("UPDATE daily_summary SET message = ? WHERE date = ?", [advice, row.date], (err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
                console.log(`  -> Saved.`);

            } catch (gErr) {
                console.error(`  -> Failed to generate advice: ${gErr.message}`);
            }

            // Avoid rate limits
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log('Backfill Complete.');
    });
}

backfill();

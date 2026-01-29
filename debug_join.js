const db = require('./db');
const imageRepo = require('./image_repo');

async function test() {
    console.log("--- Starting Debug Join ---");
    const runs = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM daily_summary ORDER BY date DESC', [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
    console.log(`Found ${runs.length} runs in DB.`);

    for (const run of runs) {
        // console.log(`Checking run: ${run.date}`);
        const images = await imageRepo.getImagesForRun(run.date);
        if (images.length > 0) {
            console.log(`[MATCH] Run ${run.date} has ${images.length} images.`);
            console.log(JSON.stringify(images[0], null, 2));
        }
    }
    console.log("--- End Debug Join ---");
}

test();

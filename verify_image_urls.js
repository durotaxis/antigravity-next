const repo = require('./repo');

async function verify() {
    try {
        console.log('Fetching runs...');
        const runs = await repo.getAllRuns();

        console.log(`Fetched ${runs.length} runs.`);

        if (runs.length === 0) {
            console.warn('⚠️ No runs found to verify.');
            return;
        }

        let foundImages = false;
        for (const run of runs) {
            if (run.images && run.images.length > 0) {
                foundImages = true;
                console.log(`\nChecking Run ID: ${run.id} (Date: ${run.date})`);
                run.images.forEach(img => {
                    console.log(`  - Image ID: ${img.id}`);
                    console.log(`    URL: ${img.url}`);

                    if (!img.url.startsWith('/assets/store/')) {
                        console.error('    ❌ ERROR: URL does not start with /assets/store/');
                        process.exit(1);
                    } else if (img.url === '/assets/store/null' || img.url === '/assets/store/undefined') {
                        console.error('    ❌ ERROR: URL contains null/undefined');
                        process.exit(1);
                    } else {
                        console.log('    ✅ URL format OK');
                    }
                });
                break; // Check only the first run with images
            }
        }

        if (!foundImages) {
            console.warn('⚠️ No runs with images found. Cannot fully verify URL format.');
        } else {
            console.log('\n✅ Verification of Image URLs PASSED');
        }

    } catch (err) {
        console.error('Verification failed:', err);
        process.exit(1);
    }
}

verify();

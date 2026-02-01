const axios = require('axios');

async function checkRuns() {
    try {
        const res = await axios.get('http://localhost:3000/api/runs');
        const runs = res.data;
        if (runs.length > 0) {
            const run = runs[0];
            console.log('Run ID:', run.id);
            if (run.images && run.images.length > 0) {
                console.log('First Image:', run.images[0]);
            } else {
                console.log('No images in first run.');
            }
        } else {
            console.log('No runs found.');
        }
    } catch (err) {
        console.error(err);
    }
}
checkRuns();

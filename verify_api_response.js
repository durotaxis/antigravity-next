const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/runs',
    method: 'GET',
};

const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        try {
            const runs = JSON.parse(data);
            console.log(`Fetched ${runs.length} runs.`);
            const runsWithImages = runs.filter(r => r.images && r.images.length > 0);
            console.log(`Runs with images: ${runsWithImages.length}`);

            if (runsWithImages.length > 0) {
                console.log('Sample image structure:', runsWithImages[0].images[0]);
            } else {
                console.log('No images found in any run. (This might be expected if no data is linked yet)');
            }
        } catch (e) {
            console.error('Error parsing JSON:', e.message);
        }
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.end();

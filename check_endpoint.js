const http = require('http');

console.log('Testing /api/advice existence...');
const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/advice',
    method: 'POST', // Advice is POST
    headers: {
        'Content-Type': 'application/json'
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log(`BODY START: ${data.substring(0, 50)}`);
        if (data.trim().startsWith('<')) {
            console.log('FAIL: Received HTML (likely 404/500)');
        } else {
            console.log('SUCCESS: Received likely JSON');
        }
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

// Send empty body just to trigger handler
req.write(JSON.stringify({ date: '2025-01-01', maxStride: 0, avgStride: 0, maxHR: 0, avgHR: 0 }));
req.end();

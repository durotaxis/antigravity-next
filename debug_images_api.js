const http = require('http');

const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/api/runs/2026-01-24/images', // use a dummy date or one likely to have data if possible, or just check empty struct
    method: 'GET',
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('--- API Response (/api/runs/:date/images) ---');
        console.log('Status:', res.statusCode);
        console.log('Body:', data);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.end();

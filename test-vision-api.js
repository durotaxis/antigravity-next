// Test the Vision Analysis API endpoint
const http = require('http');

async function testVisionAPI() {
    const filename = '2fb37d52004d970fef6abac99081d6a9aebfeca9f134710c4e1f59db349fcbe8.png';
    
    const postData = JSON.stringify({
        filename: filename
    });

    const options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/analyze-vision',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log('--- Vision Analysis API Test Results ---');
                console.log(`Status Code: ${res.statusCode}`);
                console.log('Response:');
                try {
                    const parsed = JSON.parse(data);
                    console.log(JSON.stringify(parsed, null, 2));
                    
                    if (parsed.success && parsed.data) {
                        console.log('\n✅ API Test PASSED');
                        console.log('Extracted fields:');
                        console.log('  - date:', parsed.data.date);
                        console.log('  - step_count:', parsed.data.step_count);
                        console.log('  - total_distance_km:', parsed.data.total_distance_km);
                        console.log('  - avg_stride_cm:', parsed.data.avg_stride_cm);
                        console.log('  - avg_heart_rate:', parsed.data.avg_heart_rate);
                        console.log('  - calories_kcal:', parsed.data.calories_kcal);
                        console.log('  - total_time:', parsed.data.total_time);
                    } else {
                        console.log('\n❌ API Test FAILED: Response did not include success and data');
                    }
                } catch (e) {
                    console.log(data);
                    console.log('\n❌ Failed to parse JSON response:', e.message);
                }
                resolve();
            });
        });

        req.on('error', (e) => {
            console.error('❌ Request error:', e.message);
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

// Run test
console.log('Testing Vision Analysis API...\n');
testVisionAPI().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});

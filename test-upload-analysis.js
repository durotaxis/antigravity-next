const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const url = 'http://localhost:3000/api/analyze';

async function testUpload() {
    try {
        // Find an image to test with
        const storeDir = path.join(__dirname, 'public/assets/store');
        const files = fs.readdirSync(storeDir);
        const imageFile = files.find(f => f.endsWith('.jpeg') || f.endsWith('.png'));

        if (!imageFile) {
            console.error('No image found in public/assets/store to test with.');
            return;
        }

        const filePath = path.join(storeDir, imageFile);
        console.log(`Testing upload with: ${imageFile}`);

        const form = new FormData();
        form.append('image', fs.createReadStream(filePath));

        const response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders()
            }
        });

        console.log('✅ Analysis Success!');
        console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
        if (error.response) {
            console.error('❌ Server Error:', error.response.status, error.response.data);
        } else {
            console.error('❌ Network/Client Error:', error.message);
        }
    }
}

testUpload();

const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const BASE_URL = 'http://localhost:3000';

async function uploadImage(filename) {
    const form = new FormData();
    form.append('image', fs.createReadStream(filename));

    try {
        console.log(`Uploading ${filename}...`);
        const res = await axios.post(`${BASE_URL}/api/analyze`, form, {
            headers: {
                ...form.getHeaders()
            },
            maxBodyLength: Infinity
        });
        console.log('Upload Success:', res.data);
        return res.data; // data might be null if analyze returns plain text or redirects? It returns json.
    } catch (err) {
        console.error('Upload Failed:', err.message);
        if (err.response) {
            console.error('Response:', err.response.data);
            console.error('Status:', err.response.status);
        }
        throw err;
    }
}

async function deleteRun(runId) {
    // Note: runId from API usually is "date" string for deleting images, or "id" for deleting run?
    // Wait, deleteRun/DELETE /api/runs/:id links to repo.deleteRun(id) where id is ROWID.
    // We need to fetch the run to get the rowid.

    // First fetch all runs to find the one we just created
    const res = await axios.get(`${BASE_URL}/api/runs`);
    const runs = res.data;
    // Assuming the most recent one is ours, or check message?
    // This is a bit flaky, but let's try to find a recent one.
    // For now, let's just use the ID from the run log if possible, but /api/analyze doesn't return run ID directly?
    // Image service returns "results", but /api/analyze calls visionService.analyzeImage which returns JSON data.
    // It doesn't return the Run ID.

    // So we fetch runs and look for one with today's date?
    // Or just look for the last inserted one.
    if (runs.length > 0) {
        const lastRun = runs[0]; // ordered DESC
        console.log(`Deleting Run ID: ${lastRun.id} (Date: ${lastRun.date})`);
        await axios.delete(`${BASE_URL}/api/runs/${lastRun.id}`);
        console.log('Delete Success');
    }
}

async function runTest() {
    // Create a dummy image file
    const dummyPath = path.join(__dirname, 'repro_test_image.png');
    // We need a valid image for Gemini to accept it? Or we can mock visionService?
    // Using a real image is safer. I'll rely on existing asset or create a simple text file renamed to png (Gemini will fail analysis but maybe triggered logic).
    // Actually, if Gemini fails, it throws "Vision Analysis Error".
    // I need a real image. I'll use the uploaded artifact if available, or just skip creation and try uploading an existing file if I can find one.
    // Let's assume there is an image in public/assets/store. I can copy one.

    const storeDir = path.join(__dirname, 'public/assets/store');
    const files = fs.readdirSync(storeDir);
    const pngFile = files.find(f => f.endsWith('.png'));

    if (!pngFile) {
        console.error("No PNG found in store to use for test.");
        return;
    }

    const srcPath = path.join(storeDir, pngFile);
    fs.copyFileSync(srcPath, dummyPath);
    console.log(`Created dummy image from ${pngFile}`);

    try {
        // 1. First Upload
        await uploadImage(dummyPath);

        // 2. Delete the run
        // Wait a bit for async DB ops
        await new Promise(r => setTimeout(r, 1000));
        await deleteRun();

        // 3. Re-upload same image (same content = same hash)
        console.log('--- RE-UPLOADING ---');
        await uploadImage(dummyPath);
        console.log('Re-upload passed!');

    } catch (err) {
        console.error('Test Failed.');
    } finally {
        // cleanup
        if (fs.existsSync(dummyPath)) fs.unlinkSync(dummyPath);
    }
}

runTest();

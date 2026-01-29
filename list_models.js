require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    console.log("Fetching available models...");
    try {
        // This part is tricky because the JS SDK doesn't expose listModels directly on the main class in some versions,
        // but we can try to use the modelManager if available, or just fallback to http request if SDK fails.
        // However, for v1beta, it should support it via `genAI.getGenerativeModel` isn't for listing.
        // Actually the SDK doesn't have a clean listModels method exposed easily in the strict typing,
        // but the underlying API is `GET https://generativelanguage.googleapis.com/v1beta/models`.

        // Let's use the googleapis library we already have installed to be safe and thorough!
        const { google } = require('googleapis');

        // Wait, the user's key is an API key, not OAuth for Gemini usually. 
        // The googleapis library works better with OAuth or service accounts.
        // Let's stick to a simple fetch using the API key.

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("No API KEY found in .env");
            return;
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        const data = await response.json();

        if (data.models) {
            console.log("--- Available Models ---");
            data.models.forEach(m => {
                if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
                    console.log(`- ${m.name}`);
                }
            });
            console.log("------------------------");
        } else {
            console.error("Failed to list models:", data);
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

listModels();

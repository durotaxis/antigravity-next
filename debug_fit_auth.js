const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function authorize() {
    try {
        const content = await fs.readFile(CREDENTIALS_PATH);
        const credentials = JSON.parse(content);
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

        const token = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));

        // Listen for token refresh
        oAuth2Client.on('tokens', (tokens) => {
            if (tokens.refresh_token) {
                console.log('Refreshed Token received!');
                // Save it?
            }
            console.log('Access Token Refreshed');
        });

        return oAuth2Client;
    } catch (error) {
        console.error('Auth setup failed:', error);
        throw error;
    }
}

async function testAuth() {
    try {
        const auth = await authorize();
        const fitness = google.fitness({ version: 'v1', auth });

        console.log('Listing Data Sources...');
        const res = await fitness.users.dataSources.list({ userId: 'me' });
        console.log('Success! Data Source Count:', res.data.dataSource.length);

    } catch (err) {
        if (err.response && err.response.data) {
            console.error('Auth Test Failed (API):', JSON.stringify(err.response.data, null, 2));
        } else {
            console.error('Auth Test Failed:', err.message);
        }
    }
}

testAuth();

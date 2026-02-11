const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const fs = require('fs').promises;
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '..', '..', 'credentials.json');
const TOKEN_PATH = path.join(__dirname, '..', '..', 'token.json');

async function main() {
  const scopes = [
    'https://www.googleapis.com/auth/fitness.activity.read',
    'https://www.googleapis.com/auth/fitness.location.read',
    'https://www.googleapis.com/auth/fitness.body.read',
    'https://www.googleapis.com/auth/fitness.heart_rate.read'
  ];

  const client = await authenticate({
    keyfilePath: CREDENTIALS_PATH,
    scopes,
    authOptions: { access_type: 'offline', prompt: 'consent' }
  });

  if (!client.credentials) {
    throw new Error('No credentials returned from auth flow.');
  }

  await fs.writeFile(TOKEN_PATH, JSON.stringify(client.credentials));

  // Quick sanity check (optional)
  const fitness = google.fitness({ version: 'v1', auth: client });
  const res = await fitness.users.dataSources.list({ userId: 'me' });
  console.log(`Reauth complete. Data sources: ${res.data.dataSource?.length ?? 0}`);
  console.log(`Saved: ${TOKEN_PATH}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

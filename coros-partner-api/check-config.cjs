'use strict';

// Offline preparation check only. Never prints values or contacts a server.
const fs = require('node:fs');
const path = require('node:path');
const configPath = path.join(__dirname, 'config.local.json');

function main() {
  if (!fs.existsSync(configPath)) {
    console.log('NOT CONFIGURED: copy config.example.json to config.local.json and fill in issued values.');
    process.exitCode = 1;
    return;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    console.log('INVALID: config.local.json could not be read as JSON. Values are not displayed.');
    process.exitCode = 1;
    return;
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    console.log('INVALID: configuration must be a JSON object.');
    process.exitCode = 1;
    return;
  }
  let valid = true;
  for (const key of ['clientId', 'clientSecret', 'redirectUri', 'apiReferencePath']) {
    const present = typeof config[key] === 'string' && config[key].trim().length > 0;
    console.log(`${key}: ${present ? 'PRESENT' : 'MISSING'}`);
    valid = valid && present;
  }
  if (typeof config.redirectUri === 'string' && config.redirectUri.trim()) {
    try {
      const uri = new URL(config.redirectUri);
      if (uri.username || uri.password || uri.hash) throw new Error();
      console.log('redirectUri: syntactically valid; COROS registration and acceptance are unverified.');
    } catch {
      console.log('redirectUri: INVALID URL or contains credentials/fragment.');
      valid = false;
    }
  }
  if (typeof config.apiReferencePath === 'string' && config.apiReferencePath.trim()) {
    try {
      const reference = path.resolve(__dirname, config.apiReferencePath);
      if (!fs.statSync(reference).isFile()) throw new Error();
      console.log('apiReferencePath: FILE EXISTS; official provenance and contents need review.');
    } catch {
      console.log('apiReferencePath: FILE UNAVAILABLE.');
      valid = false;
    }
  }
  console.log(valid
    ? 'PREPARATION INPUTS PRESENT. OAuth/API implementation and live verification are still required.'
    : 'PREPARATION INCOMPLETE. No network request was made.');
  process.exitCode = valid ? 0 : 1;
}
main();

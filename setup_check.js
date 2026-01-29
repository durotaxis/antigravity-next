const fs = require('fs');
const path = require('path');
const db = require('./db');

async function ensureDir() {
    const dir = path.join(__dirname, 'public', 'assets', 'store');
    if (!fs.existsSync(dir)) {
        console.log('Creating directory:', dir);
        fs.mkdirSync(dir, { recursive: true });
    } else {
        console.log('Directory exists:', dir);
    }
}

ensureDir();

// Add check-db verification to see if tables exist
db.serialize(() => {
    db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
        if (err) console.error(err);
        else console.log('Tables:', tables);
    });
});

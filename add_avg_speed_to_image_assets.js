const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DB_PATH
  ? path.resolve(process.cwd(), process.env.DB_PATH)
  : path.resolve(__dirname, 'daily.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not connect to database at', dbPath, err);
    process.exitCode = 1;
  } else {
    console.log(`Connected to database: ${dbPath}`);
  }
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS image_assets (
    asset_id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_hash TEXT UNIQUE,
    stored_filename TEXT UNIQUE,
    original_filename TEXT,
    steps INTEGER,
    total_distance REAL,
    total_time TEXT,
    avg_speed REAL,
    avg_heart_rate REAL,
    calories REAL,
    avg_stride REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`ALTER TABLE image_assets ADD COLUMN avg_speed REAL`, (err) => {
    if (err) {
      if (String(err.message || '').includes('duplicate column name')) {
        console.log('Column avg_speed already exists. Skipping.');
      } else {
        console.error('Error adding avg_speed:', err.message);
        process.exitCode = 1;
      }
    } else {
      console.log('Successfully added column: avg_speed');
    }
    db.close();
  });
});


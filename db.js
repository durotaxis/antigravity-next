const sqlite3 = require('sqlite3').verbose();
const path = require('path');
require('dotenv').config();

// チェック5: DBパスの環境変数化（分裂防止）
const dbPath = process.env.DB_PATH
    ? path.resolve(process.cwd(), process.env.DB_PATH)
    : path.resolve(__dirname, 'daily.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database at', dbPath, err);
    } else {
        console.log(`Connected to database: ${dbPath}`);
    }
});

db.serialize(() => {
    // チェック5 (最重要): date に PRIMARY KEY を指定し、UNIQUE制約を保証する
    // これで repo.js の ON CONFLICT(date) がエラーにならず機能する
    db.run(`CREATE TABLE IF NOT EXISTS daily_summary (
        date TEXT PRIMARY KEY, 
        max_stride REAL,
        avg_stride REAL,
        hr_avg REAL,
        hr_max REAL,
        avg_speed REAL,
        max_speed REAL,
        avg_cadence REAL,
        max_cadence REAL,
        message TEXT,
        created_at TEXT
    )`, (err) => {
        if (err) console.error('Error creating table daily_summary:', err);
    });

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
    )`, (err) => {
        if (err) console.error('Error creating table image_assets:', err);
    });

    db.run(`CREATE TABLE IF NOT EXISTS run_images (
        run_id TEXT NOT NULL,
        asset_id INTEGER NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(run_id, asset_id)
    )`, (err) => {
        if (err) console.error('Error creating table run_images:', err);
    });

    // Lightweight migration for existing DBs.
    db.all(`PRAGMA table_info(image_assets)`, (err, rows) => {
        if (err) return console.error('Error reading image_assets schema:', err);
        const cols = new Set((rows || []).map(r => r.name));
        if (!cols.has('avg_speed')) {
            db.run(`ALTER TABLE image_assets ADD COLUMN avg_speed REAL`, (alterErr) => {
                if (alterErr && !String(alterErr.message || '').includes('duplicate column name')) {
                    console.error('Error adding image_assets.avg_speed:', alterErr);
                }
            });
        }
    });

    // ... (他のテーブル作成処理があればここに記述) ...
    // image_assets, run_images 等
});

module.exports = db;

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
        message TEXT,
        created_at TEXT
    )`, (err) => {
        if (err) console.error('Error creating table daily_summary:', err);
    });

    // ... (他のテーブル作成処理があればここに記述) ...
    // image_assets, run_images 等
});

module.exports = db;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'daily.db');
const db = new sqlite3.Database(dbPath);

const columnsToAdd = [
    { name: 'avg_speed', type: 'REAL' },
    { name: 'max_speed', type: 'REAL' }
];

db.serialize(() => {
    columnsToAdd.forEach(col => {
        const sql = `ALTER TABLE daily_summary ADD COLUMN ${col.name} ${col.type}`;
        db.run(sql, (err) => {
            if (err) {
                if (err.message.includes('duplicate column name')) {
                    console.log(`Column ${col.name} already exists. Skipping.`);
                } else {
                    console.error(`Error adding column ${col.name}:`, err.message);
                }
            } else {
                console.log(`Successfully added column: ${col.name}`);
            }
        });
    });
});

db.close();

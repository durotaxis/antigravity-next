const db = require('./db');

const datesToDelete = [
    '2025-11-01',
    '2026-01-19'
];

function deleteRecords() {
    console.log('Deleting records for:', datesToDelete);

    // Using simple loop for safety
    datesToDelete.forEach(date => {
        db.run("DELETE FROM daily_summary WHERE date = ?", [date], function (err) {
            if (err) {
                console.error(`Failed to delete ${date}:`, err.message);
            } else {
                console.log(`Deleted ${date}: ${this.changes} rows affected.`);
            }
        });
    });
}

deleteRecords();

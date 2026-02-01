const db = require('./db');

function cleanDailySummary() {
    console.log('🧹 Starting Daily Summary Cleanup...');

    const condition = "max_stride = 0";

    // First, count how many
    db.get(`SELECT COUNT(*) as count FROM daily_summary WHERE ${condition}`, (err, row) => {
        if (err) {
            console.error('Error counting records:', err);
            return;
        }

        const count = row.count;
        if (count === 0) {
            console.log('✨ No records found with max_stride = 0. Nothing to delete.');
            return;
        }

        console.log(`Found ${count} records with max_stride = 0. Deleting...`);

        db.run(`DELETE FROM daily_summary WHERE ${condition}`, function (err) {
            if (err) {
                console.error('Error deleting records:', err);
            } else {
                console.log(`✅ Successfully deleted ${this.changes} records.`);
            }
        });
    });
}

cleanDailySummary();

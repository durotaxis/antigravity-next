const db = require('./db');
const repo = require('./repo');

async function checkMessage() {
    console.log('🔍 Checking latest daily summary message...');
    try {
        const sql = 'SELECT date, message FROM daily_summary ORDER BY date DESC LIMIT 1';
        db.get(sql, [], (err, row) => {
            if (err) {
                console.error(err);
            } else {
                console.log('Result:', row);
                if (row && row.date) {
                    console.log(`Checking API for date: ${row.date}`);
                    // We can also try to fetch via fetch/http if needed, but db check confirms data exists
                }
            }
        });
    } catch (e) {
        console.error(e);
    }
}
checkMessage();

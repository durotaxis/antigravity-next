const db = require('./db');

db.get("SELECT * FROM daily_summary WHERE date = '2026-01-19'", (err, row) => {
    if (err) {
        console.error(err);
    } else {
        console.log(JSON.stringify(row, null, 2));
    }
});

const db = require('./db');

db.all('SELECT * FROM run_images LIMIT 10', [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log('run_images content:');
        console.table(rows);
    }
});

db.all('SELECT rowid as id, date FROM daily_summary LIMIT 5', [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log('daily_summary content:');
        console.table(rows);
    }
});

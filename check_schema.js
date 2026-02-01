const db = require('./db');

db.all("SELECT sql FROM sqlite_master WHERE type='table' AND name='run_images'", (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
});

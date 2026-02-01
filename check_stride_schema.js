const db = require('./db');

db.all("SELECT sql FROM sqlite_master WHERE type='table' AND name='stride_data'", (err, rows) => {
    if (err) console.error(err);
    else {
        if (rows.length > 0) console.log(rows[0].sql);
        else console.log('Table stride_data NOT FOUND');
    }
});

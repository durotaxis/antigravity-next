const db = require('./db');

// Check for duplicates in run_images
const sql = `
    SELECT run_id, asset_id, COUNT(*) as count
    FROM run_images
    GROUP BY run_id, asset_id
    HAVING count > 1
`;

db.all(sql, [], (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log('Duplicate Pairs found:', rows);

        if (rows.length > 0) {
            console.log('Inspecting 2025-11-01 specifically...');
            db.all("SELECT rowid, * FROM run_images WHERE run_id = '2025-11-01'", [], (e, r) => {
                console.log(r);
            });
        }
    }
});

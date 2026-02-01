const db = require('./db');

// Check duplicates for 2025-11-01
console.log('Inspecting entries for 2025-11-01...');
const sql = `
    SELECT r.rowid as link_id, r.run_id, r.asset_id, a.file_hash, a.stored_filename
    FROM run_images r
    JOIN image_assets a ON r.asset_id = a.asset_id
    WHERE r.run_id = '2025-11-01'
`;

db.all(sql, [], (err, rows) => {
    if (err) console.error(err);
    else {
        console.log(JSON.stringify(rows, null, 2));
    }
});

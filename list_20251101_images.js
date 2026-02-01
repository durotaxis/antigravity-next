const db = require('./db');

console.log('--- Images for 2025-11-01 ---');
const sql = `
    SELECT r.rowid as link_id, r.asset_id, a.stored_filename, a.original_filename
    FROM run_images r
    JOIN image_assets a ON r.asset_id = a.asset_id
    WHERE r.run_id = '2025-11-01'
`;

db.all(sql, [], (err, rows) => {
    if (err) console.error(err);
    else {
        rows.forEach(r => {
            console.log(`LinkID: ${r.link_id}, AssetID: ${r.asset_id}, File: ${r.stored_filename}, Orig: ${r.original_filename}`);
        });
    }
});

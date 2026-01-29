const db = require('./db');

const sql = `
    SELECT 
        asset_id, 
        stored_filename, 
        created_at,
        steps, 
        total_distance, 
        total_time, 
        avg_heart_rate, 
        avg_stride, 
        calories 
    FROM image_assets
    ORDER BY asset_id DESC
`;

db.all(sql, [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log('--- Image Assets Data ---');
    if (rows.length === 0) {
        console.log('No assets found.');
    } else {
        console.table(rows);
    }
});

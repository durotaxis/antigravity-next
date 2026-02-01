const db = require('./db');

const sql = `
    SELECT date, hr_avg, hr_max 
    FROM daily_summary 
    WHERE hr_avg > 0 AND (hr_max IS NULL OR hr_max = 0)
`;

db.all(sql, [], (err, rows) => {
    if (err) {
        console.error("Error querying DB:", err);
        return;
    }

    if (rows.length === 0) {
        console.log("✅ No inconsistent Heart Rate records found (Avg > 0 && Max == 0).");
    } else {
        console.log(`⚠️  Found ${rows.length} inconsistent records:`);
        rows.forEach(row => {
            console.log(`   - Date: ${row.date}, Avg: ${row.hr_avg}, Max: ${row.hr_max}`);
        });
    }

    // Check Stride too just in case
    db.all(`SELECT date, avg_stride, max_stride FROM daily_summary WHERE avg_stride > 0 AND (max_stride IS NULL OR max_stride = 0)`, [], (err, sRows) => {
        if (sRows.length > 0) {
            console.log(`⚠️  Found ${sRows.length} inconsistent Stride records:`);
            sRows.forEach(row => {
                console.log(`   - Date: ${row.date}, Avg: ${row.avg_stride}, Max: ${row.max_stride}`);
            });
        }
    });

});

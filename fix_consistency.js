const db = require('./db');

function fix() {
    console.log("🔧 Starting Data Consistency Fix...");

    db.serialize(() => {
        // 1. Fix Heart Rate: Set hr_max = hr_avg where hr_max is 0/null but hr_avg exists
        db.run(`
            UPDATE daily_summary 
            SET hr_max = hr_avg 
            WHERE hr_avg > 0 AND (hr_max IS NULL OR hr_max = 0)
        `, function (err) {
            if (err) console.error("Error fixing Heart Rate:", err);
            else console.log(`   - Fixed Heart Rate for ${this.changes} records.`);
        });

        // 2. Fix Stride: Set max_stride = avg_stride where max_stride is 0/null but avg_stride exists
        db.run(`
            UPDATE daily_summary 
            SET max_stride = avg_stride 
            WHERE avg_stride > 0 AND (max_stride IS NULL OR max_stride = 0)
        `, function (err) {
            if (err) console.error("Error fixing Stride:", err);
            else console.log(`   - Fixed Stride for ${this.changes} records.`);
        });
    });

    // Close after short delay
    setTimeout(() => {
        db.close();
        console.log("✅ Fix Complete.");
    }, 1000);
}

fix();

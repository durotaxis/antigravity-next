const db = require('./db');

db.serialize(() => {
    db.run("ALTER TABLE daily_summary ADD COLUMN avg_cadence REAL", (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('avg_cadence column already exists.');
            } else {
                console.error('Error adding avg_cadence:', err.message);
            }
        } else {
            console.log('Added avg_cadence column.');
        }
    });

    db.run("ALTER TABLE daily_summary ADD COLUMN max_cadence REAL", (err) => {
        if (err) {
            if (err.message.includes('duplicate column name')) {
                console.log('max_cadence column already exists.');
            } else {
                console.error('Error adding max_cadence:', err.message);
            }
        } else {
            console.log('Added max_cadence column.');
        }
    });
});

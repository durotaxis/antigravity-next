const db = require('./db');

async function cleanDuplicates() {
    console.log('Running consistency check...');

    // Find duplicates: Same Run ID + Same File Hash
    // (Meaning multiple assets pointing to same content, or same asset linked twice)

    const sql = `
        SELECT r.run_id, a.file_hash, COUNT(*) as cnt
        FROM run_images r
        JOIN image_assets a ON r.asset_id = a.asset_id
        GROUP BY r.run_id, a.file_hash
        HAVING cnt > 1
    `;

    db.all(sql, [], async (err, rows) => {
        if (err) return console.error(err);

        console.log(`Found ${rows.length} duplicate groups.`);

        for (const row of rows) {
            console.log(`Cleaning duplicates for Run: ${row.run_id}, Hash: ${row.file_hash}`);

            // Get all link_ids for this combination
            const linkSql = `
                SELECT r.rowid as link_id
                FROM run_images r
                JOIN image_assets a ON r.asset_id = a.asset_id
                WHERE r.run_id = ? AND a.file_hash = ?
                ORDER BY r.rowid DESC
            `;

            const links = await new Promise((resolve, reject) => {
                db.all(linkSql, [row.run_id, row.file_hash], (e, r) => e ? reject(e) : resolve(r));
            });

            // Keep the first one (or last?), delete others
            // Let's keep the one with the smallest ID (oldest) or largest? 
            // Usually keeping the one that might be 'original' is safer, but keeping latest is fine too.
            // Let's keep the NEWEST (largest ID) assuming it might have fresher metadata, 
            // OR keep OLDEST to preserve history. Let's keep OLDEST (smallest ID) to be stable.
            // Wait, logic above ordered by DESC, so [0] is newest.

            // Let's keep the OLDEST (last in DESC list, or sort ASC).
            // Let's sort ASC to be clear.
            links.sort((a, b) => a.link_id - b.link_id);

            const keep = links[0];
            const remove = links.slice(1);

            console.log(`  Keeping link_id: ${keep.link_id}, Removing: ${remove.map(x => x.link_id).join(', ')}`);

            for (const rItem of remove) {
                await new Promise((resolve, reject) => {
                    db.run("DELETE FROM run_images WHERE rowid = ?", [rItem.link_id], (e) => e ? reject(e) : resolve());
                });
            }
        }
        console.log('Done.');
    });
}

cleanDuplicates();

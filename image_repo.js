const db = require('./db');

/**
 * Create a new image asset record
 */
function createAsset(fileHash, storedFilename, originalFilename) {
    return new Promise((resolve, reject) => {
        // First check if exists
        db.get('SELECT asset_id FROM image_assets WHERE file_hash = ?', [fileHash], (err, row) => {
            if (err) return reject(err);
            if (row) {
                console.log(`Asset already exists (ID: ${row.asset_id}). Reusing.`);
                return resolve(row.asset_id);
            }

            // If not exists, insert
            const sql = `INSERT INTO image_assets (file_hash, stored_filename, original_filename) VALUES (?, ?, ?)`;
            db.run(sql, [fileHash, storedFilename, originalFilename], function (err) {
                if (err) return reject(err);
                resolve(this.lastID);
            });
        });
    });
}

/**
 * Register asset wrapper (compat for index.js)
 */
function registerAsset(storedFilename, originalFilename) {
    // Extract hash from upload_HASH.ext
    let hash = storedFilename;
    const parts = storedFilename.split('_');
    if (parts.length >= 2) {
        hash = parts[1].split('.')[0];
    }
    return createAsset(hash, storedFilename, originalFilename);
}

/**
 * Find asset by hash
 */
function findAssetByHash(fileHash) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM image_assets WHERE file_hash = ?', [fileHash], (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

/**
 * Link an asset to a run_id (Date)
 */
function linkImageToRun(runId, assetId) {
    return new Promise((resolve, reject) => {
        const sql = `INSERT OR IGNORE INTO run_images (run_id, asset_id) VALUES (?, ?)`;
        db.run(sql, [runId, assetId], function (err) {
            if (err) return reject(err);
            resolve(this.changes);
        });
    });
}

/**
 * Get all images for a specific run
 */
function getImagesForRun(runId) {
    return new Promise((resolve, reject) => {
        const sql = `
      SELECT a.*, r.run_id 
      FROM image_assets a
      JOIN run_images r ON a.asset_id = r.asset_id
      WHERE r.run_id = ?
      ORDER BY r.display_order ASC, a.created_at DESC
    `;
        db.all(sql, [runId], (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });
}


/**
 * Unlink an image from a run
 */
function unlinkImageFromRun(runId, assetId) {
    return new Promise((resolve, reject) => {
        const sql = `DELETE FROM run_images WHERE run_id = ? AND asset_id = ?`;
        db.run(sql, [runId, assetId], function (err) {
            if (err) return reject(err);
            resolve(this.changes);
        });
    });
}

/**
 * Update analysis metrics for an asset
 */
function updateAssetMetrics(storedFilename, metrics) {
    return new Promise((resolve, reject) => {
        const sql = `
            UPDATE image_assets 
            SET 
                steps = ?, 
                total_distance = ?, 
                total_time = ?, 
                avg_speed = ?,
                avg_heart_rate = ?, 
                calories = ?, 
                avg_stride = ?
            WHERE stored_filename = ?
        `;
        const params = [
            metrics.step_count ?? null,
            metrics.total_distance_km ?? null,
            metrics.total_time ?? null,
            metrics.avg_speed ?? null,
            metrics.avg_heart_rate ?? null,
            metrics.calories_kcal ?? null,
            metrics.avg_stride_cm ?? null,
            storedFilename
        ];

        console.log('Update Params:', params);

        const runUpdate = () => {
            db.run(sql, params, function (err) {
                if (err) {
                    console.error('Update Error:', err);
                    return reject(err);
                }
                console.log('Rows updated:', this.changes);
                resolve(this.changes);
            });
        };

        db.run(sql, params, function (err) {
            if (err && String(err.message || '').includes('no such column: avg_speed')) {
                // One-time self-heal for older DBs.
                return db.run(`ALTER TABLE image_assets ADD COLUMN avg_speed REAL`, (alterErr) => {
                    if (alterErr && !String(alterErr.message || '').includes('duplicate column name')) {
                        console.error('Migration Error (avg_speed):', alterErr);
                        return reject(alterErr);
                    }
                    runUpdate();
                });
            }

            if (err) {
                console.error('Update Error:', err);
                return reject(err);
            }
            console.log('Rows updated:', this.changes);
            resolve(this.changes);
        });
    });
}

/**
 * Update analysis metrics for an asset by asset_id.
 * This is safer than stored_filename when assets are de-duplicated by file_hash.
 */
function updateAssetMetricsById(assetId, metrics) {
    return new Promise((resolve, reject) => {
        const sql = `
            UPDATE image_assets 
            SET 
                steps = ?, 
                total_distance = ?, 
                total_time = ?, 
                avg_speed = ?,
                avg_heart_rate = ?, 
                calories = ?, 
                avg_stride = ?
            WHERE asset_id = ?
        `;
        const params = [
            metrics.step_count ?? null,
            metrics.total_distance_km ?? null,
            metrics.total_time ?? null,
            metrics.avg_speed ?? null,
            metrics.avg_heart_rate ?? null,
            metrics.calories_kcal ?? null,
            metrics.avg_stride_cm ?? null,
            assetId
        ];

        const runUpdate = () => {
            db.run(sql, params, function (err) {
                if (err) {
                    console.error('Update Error:', err);
                    return reject(err);
                }
                resolve(this.changes);
            });
        };

        db.run(sql, params, function (err) {
            if (err && String(err.message || '').includes('no such column: avg_speed')) {
                return db.run(`ALTER TABLE image_assets ADD COLUMN avg_speed REAL`, (alterErr) => {
                    if (alterErr && !String(alterErr.message || '').includes('duplicate column name')) {
                        console.error('Migration Error (avg_speed):', alterErr);
                        return reject(alterErr);
                    }
                    runUpdate();
                });
            }
            if (err) return reject(err);
            resolve(this.changes);
        });
    });
}

module.exports = {
    createAsset,
    registerAsset,
    findAssetByHash,
    linkImageToRun,
    getImagesForRun,
    unlinkImageFromRun,
    updateAssetMetrics,
    updateAssetMetricsById,
    deleteAssetWithFile
};

/**
 * Delete asset from DB and filesystem
 */
const fs = require('fs').promises;
const path = require('path');
const STORE_DIR = path.join(__dirname, 'public/assets/store');

function deleteAssetWithFile(assetId) {
    return new Promise((resolve, reject) => {
        // 1. Get Filename
        db.get('SELECT stored_filename FROM image_assets WHERE asset_id = ?', [assetId], async (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(0); // Not found

            const filename = row.stored_filename;

            try {
                // 2. Delete File
                if (filename) {
                    const filePath = path.join(STORE_DIR, filename);
                    await fs.unlink(filePath).catch(e => console.log(`File cleanup skipped: ${e.message}`));
                }

                db.serialize(() => {
                    // 3. Delete DB Records
                    db.run('DELETE FROM run_images WHERE asset_id = ?', [assetId]);
                    db.run('DELETE FROM image_assets WHERE asset_id = ?', [assetId], function (err) {
                        if (err) return reject(err);
                        resolve(this.changes);
                    });
                });

            } catch (e) {
                reject(e);
            }
        });
    });
}

const db = require('./db');
const repo = require('./repo');

function getRunIdsWithImages() {
  return new Promise((resolve, reject) => {
    db.all('SELECT DISTINCT run_id FROM run_images ORDER BY run_id ASC', (err, rows) => {
      if (err) return reject(err);
      resolve((rows || []).map(r => r.run_id).filter(Boolean));
    });
  });
}

function getBestImageMetricsForRun(runId) {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT
        a.steps,
        a.total_distance,
        a.total_time,
        a.avg_speed,
        a.avg_heart_rate,
        a.calories,
        a.avg_stride,
        a.created_at
      FROM image_assets a
      JOIN run_images r ON a.asset_id = r.asset_id
      WHERE r.run_id = ?
      ORDER BY a.created_at DESC
    `;
    db.all(sql, [runId], (err, rows) => {
      if (err) return reject(err);
      const list = rows || [];
      const best = list.find(row => {
        return (
          row.steps !== null ||
          row.total_distance !== null ||
          row.total_time !== null ||
          row.avg_speed !== null ||
          row.avg_heart_rate !== null ||
          row.calories !== null ||
          row.avg_stride !== null
        );
      });
      resolve(best || null);
    });
  });
}

async function main() {
  const runIds = await getRunIdsWithImages();
  let updated = 0;
  let skipped = 0;

  for (const runId of runIds) {
    const img = await getBestImageMetricsForRun(runId);
    if (!img) {
      skipped++;
      continue;
    }

    const payload = {
      date: runId,
      step_count: img.steps,
      total_distance_km: img.total_distance,
      total_time: img.total_time,
      calories_kcal: img.calories,
      avg_speed: img.avg_speed,
      hr_avg: img.avg_heart_rate,
      avg_stride: img.avg_stride
    };

    const changed = await repo.saveDailySummary(payload);
    if (changed > 0) updated++;
    else skipped++;
  }

  console.log(`Done. updated=${updated} skipped=${skipped} runs=${runIds.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


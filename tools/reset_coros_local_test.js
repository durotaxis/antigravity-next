const fs = require('fs').promises;
const path = require('path');
const db = require('../db');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || '').trim() : '';
}

function run(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this.changes || 0);
    });
  });
}

async function removeIfExists(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function main() {
  const date = argument('--date');
  const labelId = argument('--label-id');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Valid --date YYYY-MM-DD is required');
  if (!/^\d+$/.test(labelId)) throw new Error('Numeric --label-id is required');

  const root = path.resolve(__dirname, '..');
  const sourceFit = path.join(root, 'data', 'coros', 'fit', `${date}_${labelId}.fit`);
  const sourceMetadata = path.join(root, 'data', 'coros', 'metadata', `${date}_${labelId}.json`);
  await fs.access(sourceFit);
  await fs.access(sourceMetadata);

  const generatedFiles = [
    path.join(root, 'data', 'coros', 'intraday', `${date}_${labelId}.json`),
    path.join(root, 'data', 'coros', 'route', `${date}_${labelId}.json`),
    path.join(root, 'data', 'coros', 'splits', `${date}_${labelId}.json`),
    path.join(root, 'data', 'run-comment', 'inbox', `run_${labelId}.json`),
    path.join(root, 'data', 'run-comment', 'processed', `run_${labelId}.json`)
  ];
  const removedFiles = [];
  for (const filePath of generatedFiles) {
    if (await removeIfExists(filePath)) removedFiles.push(path.relative(root, filePath));
  }

  const removedRunMessages = await run('DELETE FROM run_messages WHERE date = ? AND run_id = ?', [date, labelId]);
  const removedDailySummaries = await run('DELETE FROM daily_summary WHERE date = ?', [date]);

  console.log(JSON.stringify({
    resetTo: 'coros-downloaded-local-not-imported',
    date,
    labelId,
    preserved: [path.relative(root, sourceFit), path.relative(root, sourceMetadata), 'data/run-comment/state/coros-sync-state.json'],
    removedFiles,
    removedRunMessages,
    removedDailySummaries
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  })
  .finally(() => db.close());

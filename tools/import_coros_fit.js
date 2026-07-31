const path = require('path');
const { importCorosFit } = require('../coros_fit_importer');

async function main() {
  const [fitArg, metadataArg, outputArg] = process.argv.slice(2);
  if (!fitArg || !metadataArg || !outputArg) {
    throw new Error('Usage: node tools/import_coros_fit.js <fit> <metadata.json> <output.json>');
  }
  const result = await importCorosFit({
    fitPath: path.resolve(fitArg), metadataPath: path.resolve(metadataArg), outputPath: path.resolve(outputArg)
  });
  console.log(JSON.stringify({ source: result.source, labelId: result.labelId, recordCount: result.recordCount, minuteCount: result.chartData.length, cadenceMedian: result.cadenceMedian, cadenceMultiplier: result.cadenceMultiplier }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

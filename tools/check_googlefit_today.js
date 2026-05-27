const path = require('path');
const googleFit = require('../google_fit_service');

async function main() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;
  console.log('Fetching intraday for', date);
  try {
    const result = await googleFit.getIntradayMetrics(date);
    if (!result) {
      console.log('No intraday result');
      process.exit(0);
    }
    // result is likely an array of points or an object with data
    const points = Array.isArray(result) ? result : (result.data || result.points || result);

    const pts = Array.isArray(points) ? points : [];
    console.log('points_count=', pts.length);
    const sources = new Set();
    for (const p of pts) {
      if (p && p.source) sources.add(String(p.source).toLowerCase());
      // some points may have vendor info in p.source or p.device
      if (p && p.device) sources.add(String(p.device).toLowerCase());
    }
    console.log('sources=', Array.from(sources));
    console.log('first_10_points=', JSON.stringify(pts.slice(0, 10), null, 2));
  } catch (err) {
    console.error('Error fetching intraday:', err && err.message ? err.message : err);
    process.exit(1);
  }
}

main();

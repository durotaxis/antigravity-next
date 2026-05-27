const googleFit = require('../google_fit_service');

async function main() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const date = `${yyyy}-${mm}-${dd}`;
  console.log('Rebuilding caches for', date);
  try {
    const sessions = await googleFit.fetchSessionsForDate(date);
    console.log('Sessions fetched:', sessions.length);
  } catch (err) {
    console.error('Failed to fetch sessions:', err && err.message ? err.message : err);
  }
  try {
    const intraday = await googleFit.getIntradayMetrics(date);
    if (!intraday) {
      console.log('No intraday data returned');
    } else {
      const points = Array.isArray(intraday) ? intraday : (intraday.data || intraday.points || intraday);
      console.log('Intraday points after rebuild:', Array.isArray(points) ? points.length : 0);
      console.log('Sample sources:', [...new Set((Array.isArray(points) ? points : []).map(p => (p && p.source) || p.device || ''))].slice(0,10));
    }
  } catch (err) {
    console.error('Failed to fetch intraday metrics:', err && err.message ? err.message : err);
  }
}

main();

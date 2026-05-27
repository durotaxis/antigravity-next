const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

async function main() {
  const root = process.cwd();
  const credentials = JSON.parse(fs.readFileSync(path.join(root, 'credentials.json'), 'utf8'));
  const token = JSON.parse(fs.readFileSync(path.join(root, 'token.json'), 'utf8'));
  const c = credentials.installed || credentials.web;
  const auth = new google.auth.OAuth2(c.client_id, c.client_secret, c.redirect_uris[0]);
  auth.setCredentials(token);

  const fitness = google.fitness({ version: 'v1', auth });
  const date = process.argv[2] || '2026-05-26';
  const sessions = JSON.parse(
    fs.readFileSync(path.join(root, 'storage', 'cache', `sessions_${date}.json`), 'utf8')
  );
  const target = sessions.find(
    (s) => s.application && s.application.packageName === 'com.yf.smart.coros.dist'
  );
  if (!target) {
    throw new Error(`Target COROS session not found for ${date}`);
  }

  const datasetId = `${Number(target.startTimeMillis) * 1000000}-${Number(target.endTimeMillis) * 1000000}`;
  const dsResp = await fitness.users.dataSources.list({ userId: 'me' });
  const all = Array.isArray(dsResp.data.dataSource) ? dsResp.data.dataSource : [];
  const wanted = all.filter((ds) => {
    const name = String(ds.dataType?.name || '').toLowerCase();
    return (
      name.includes('speed') ||
      name.includes('location') ||
      name.includes('activity.segment') ||
      name.includes('distance')
    );
  });

  const results = [];
  for (const ds of wanted) {
    try {
      const resp = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: ds.dataStreamId,
        datasetId
      });
      const points = Array.isArray(resp.data.point) ? resp.data.point : [];
      results.push({
        dataStreamId: ds.dataStreamId,
        dataType: ds.dataType?.name || null,
        application: ds.application || null,
        pointCount: points.length,
        samplePoints: points.slice(0, 20).map((p) => ({
          startTimeNanos: p.startTimeNanos,
          endTimeNanos: p.endTimeNanos,
          originDataSourceId: p.originDataSourceId || null,
          value: p.value || []
        }))
      });
    } catch (err) {
      results.push({
        dataStreamId: ds.dataStreamId,
        dataType: ds.dataType?.name || null,
        application: ds.application || null,
        error: err?.response?.data || err.message
      });
    }
  }

  const out = {
    date,
    session: {
      startTimeMillis: target.startTimeMillis,
      endTimeMillis: target.endTimeMillis,
      application: target.application,
      name: target.name || ''
    },
    candidateSources: results
  };

  const outPath = path.join(root, 'storage', 'cache', `fit_candidate_sources_${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        outPath,
        sourceCount: results.length,
        withPoints: results
          .filter((r) => r.pointCount > 0)
          .map((r) => ({
            dataType: r.dataType,
            dataStreamId: r.dataStreamId,
            pointCount: r.pointCount
          }))
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

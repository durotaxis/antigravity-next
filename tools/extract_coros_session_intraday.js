const fs = require('fs');
const path = require('path');

const date = process.argv[2] || (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}` })();
const cacheDir = path.join(__dirname, '..', 'storage', 'cache');
const sessionsFile = path.join(cacheDir, `sessions_${date}.json`);
const rawFile = path.join(cacheDir, `raw_buckets_${date}.json`);
const outFile = path.join(cacheDir, `intraday_coros_${date}.json`);

function toTimeString(millis){
  const d = new Date(Number(millis));
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

function sumIntValues(ds){
  if(!ds || !ds.point) return 0;
  let total=0;
  for(const p of ds.point){
    for(const v of (p.value||[])){
      total += (Number(v.intVal)||0);
    }
  }
  return total;
}
function sumFpValues(ds){
  if(!ds || !ds.point) return 0;
  let total=0;
  for(const p of ds.point){
    for(const v of (p.value||[])){
      total += (Number(v.fpVal)||0);
    }
  }
  return total;
}
function avgFpValue(ds){
  if(!ds || !ds.point) return 0;
  // pick first point fpVal
  for(const p of ds.point){
    for(const v of (p.value||[])){
      if(v.fpVal!==undefined) return Number(v.fpVal);
    }
  }
  return 0;
}

if(!fs.existsSync(sessionsFile)){
  console.error('No sessions cache for', date);
  process.exit(1);
}
if(!fs.existsSync(rawFile)){
  console.error('No raw buckets cache for', date);
  process.exit(1);
}

const sessions = JSON.parse(fs.readFileSync(sessionsFile,'utf8'));
const raw = JSON.parse(fs.readFileSync(rawFile,'utf8'));

// Find COROS session(s)
const corosSessions = sessions.filter(s=> String(s.application?.packageName||'').toLowerCase().includes('coros') || String(s.application?.packageName||'').toLowerCase().includes('yf.smart'));
if(corosSessions.length===0){
  console.error('No COROS sessions found in sessions cache');
  process.exit(1);
}
console.log('Found coros sessions:', corosSessions.map(s=>({id:s.id, start:s.startTimeMillis, end:s.endTimeMillis, name:s.name}))); 

const points = [];
for(const s of corosSessions){
  const start = Number(s.startTimeMillis);
  const end = Number(s.endTimeMillis);
  for(const bucket of raw){
    const startMs = Number(bucket.startTimeMillis);
    const endMs = Number(bucket.endTimeMillis);
    // if bucket overlaps session
    if(endMs < start || startMs > end) continue;
    const datasets = bucket.dataset || [];
    const stepDs = datasets.find(d=>d.dataSourceId && d.dataSourceId.includes('step_count'));
    const distDs = datasets.find(d=>d.dataSourceId && d.dataSourceId.includes('distance'));
    const hrDs = datasets.find(d=>d.dataSourceId && d.dataSourceId.includes('heart_rate')) || datasets.find(d=>d.dataSourceId && d.dataSourceId.includes('heart_rate.summary'));
    const steps = sumIntValues(stepDs);
    const distance = sumFpValues(distDs); // meters
    const hr = avgFpValue(hrDs);
    const stride = (steps>0 ? (distance*100)/steps : 0);
    const speed = Number((distance*0.06).toFixed(1));

    // Determine source from available dataSourceId / originDataSourceId values
    const sourceCandidates = [];
    if (stepDs && stepDs.dataSourceId) sourceCandidates.push(stepDs.dataSourceId);
    if (distDs && distDs.dataSourceId) sourceCandidates.push(distDs.dataSourceId);
    if (hrDs && hrDs.dataSourceId) sourceCandidates.push(hrDs.dataSourceId);
    // also inspect point-level originDataSourceId if present
    for (const ds of datasets) {
      if (ds.point && ds.point.length > 0) {
        for (const p of ds.point) {
          if (p.originDataSourceId) sourceCandidates.push(p.originDataSourceId);
        }
      }
    }
    const sourceRaw = sourceCandidates.find(Boolean) || '';
    // Use the raw dataSourceId/originDataSourceId as `source` and also keep a simplified label
    const sourceLabel = String(sourceRaw).split(':').pop() || sourceRaw;
    points.push({ time: toTimeString(startMs), steps, distance: Number(distance.toFixed(1)), stride: Number(stride.toFixed(1)), heartRate: Math.round(hr)||0, speed, source: sourceRaw, source_label: sourceLabel });
  }
}

if(points.length===0){
  console.error('No intraday points extracted for COROS session(s)');
  process.exit(1);
}

fs.writeFileSync(outFile, JSON.stringify(points, null, 2));
console.log('Wrote coros intraday file:', outFile, 'points=', points.length);
console.log('Sample:', JSON.stringify(points.slice(0,10), null, 2));

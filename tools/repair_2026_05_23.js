const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const date = '2026-05-23';
const intradayFile = path.join(__dirname, '..', 'storage', 'cache', `intraday_${date}.json`);
const raw = fs.readFileSync(intradayFile,'utf8');
const points = JSON.parse(raw);
let sum=0;
for(const p of points) sum += Number(p.steps||0);
const db = new sqlite3.Database(path.join(__dirname, '..', 'daily.db'));
const totalTimeMinutes = (()=>{return new Promise((res,rej)=>{db.get("SELECT total_time FROM daily_summary WHERE date=?",[date],(err,row)=>{if(err) return rej(err); if(!row) return rej(new Error('no row')); const parts = String(row.total_time||'0:0:0').split(':').map(Number); const sec = (parts[0]||0)*3600 + (parts[1]||0)*60 + (parts[2]||0); res(sec/60);});});})();

(async ()=>{
  try{
    const mins = await totalTimeMinutes;
    const avgCadence = mins>0?Math.round(sum / mins):0;
    console.log('Updating',date,'step_count=',sum,'avg_cadence=',avgCadence);
    db.run('UPDATE daily_summary SET step_count=?, avg_cadence=? WHERE date=?',[sum,avgCadence,date],function(err){
      if(err) {console.error(err); process.exit(1);} console.log('Updated rows=',this.changes); process.exit(0);
    });
  }catch(err){console.error(err);process.exit(1);} 
})();

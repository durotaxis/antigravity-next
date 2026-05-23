const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'storage', 'cache', 'intraday_2026-05-23.json');
const raw = fs.readFileSync(file,'utf8');
const points = JSON.parse(raw);
let sum=0;
for(const p of points){sum += Number(p.steps||0);} 
console.log('steps_sum=',sum);
// Also compute total distance meters from intraday distance (assuming distance is meters per minute in file)
let distSum=0;for(const p of points){distSum += Number(p.distance||0);} console.log('distance_sum_m=',distSum);
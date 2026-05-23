const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'storage', 'cache', 'intraday_2026-05-23.json');
const raw = fs.readFileSync(file,'utf8');
const points = JSON.parse(raw);
let sum=0, distSum=0;
for(const p of points){sum += Number(p.steps||0); distSum += Number(p.distance||0);} 
console.log(JSON.stringify({steps_sum:sum, distance_sum_m:distSum}));

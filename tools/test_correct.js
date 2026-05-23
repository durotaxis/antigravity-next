function correctBatchSummaryStepNoise(stepCount, totalTime, totalDistanceKm){
  const rawSteps=Number(stepCount||0);
  const sec=((hms)=>{const parts=hms.split(':').map(Number);return (parts[0]||0)*3600+(parts[1]||0)*60+(parts[2]||0);})(totalTime);
  const distanceKm=Number(totalDistanceKm||0);
  if(!(rawSteps>0)||!(sec>0))return{step_count:rawSteps,avg_cadence:0,avg_stride_cm:0,corrected:false};
  const rawCadence=Math.round(rawSteps/(sec/60));
  if(rawCadence<=200)return{step_count:rawSteps,avg_cadence:rawCadence,avg_stride_cm:distanceKm>0?Number(((distanceKm*100000)/rawSteps).toFixed(1)):0,corrected:false};
  const rawText=String(Math.round(rawSteps));
  if(rawText.length<2)return{step_count:rawSteps,avg_cadence:rawCadence,avg_stride_cm:distanceKm>0?Number(((distanceKm*100000)/rawSteps).toFixed(1)):0,corrected:false};
  const trimmedSteps=Number(rawText.slice(1));
  if(!(trimmedSteps>0))return{step_count:rawSteps,avg_cadence:rawCadence,avg_stride_cm:distanceKm>0?Number(((distanceKm*100000)/rawSteps).toFixed(1)):0,corrected:false};
  const candidateAvgCadence=Math.round(trimmedSteps/(sec/60));
  const candidateAvgStride=distanceKm>0?Number(((distanceKm*100000)/trimmedSteps).toFixed(1)):0;
  const cadenceOk=candidateAvgCadence>=30&&candidateAvgCadence<=200;
  const strideOk=candidateAvgStride>=30&&candidateAvgStride<=150;
  if(cadenceOk&&strideOk)return{step_count:trimmedSteps,avg_cadence:candidateAvgCadence,avg_stride_cm:candidateAvgStride,corrected:true};
  console.log('[TEST REJECTED] raw_step_count='+rawSteps+' trimmed='+trimmedSteps+' candidate_cadence='+candidateAvgCadence+' candidate_stride='+candidateAvgStride);
  return{step_count:rawSteps,avg_cadence:rawCadence,avg_stride_cm:distanceKm>0?Number(((distanceKm*100000)/rawSteps).toFixed(1)):0,corrected:false};
}

console.log(JSON.stringify(correctBatchSummaryStepNoise(410,'01:00:00',7.68),null,2));
console.log(JSON.stringify(correctBatchSummaryStepNoise(7410,'01:00:00',7.68),null,2));

const fs = require('fs').promises;
const path = require('path');

const SEMICIRCLES_TO_DEGREES = 180 / (2 ** 31);
const MINUTE_DISTANCE_DEVIATION_THRESHOLD = 0.39;

function parseJsonText(text) {
  return JSON.parse(String(text ?? '').replace(/^\uFEFF/, ''));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function tokyoMinuteLabel(timestampMs) {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(timestampMs));
}

function normalizeRecord(record) {
  const timestampMs = record?.timestamp instanceof Date
    ? record.timestamp.getTime()
    : Date.parse(String(record?.timestamp || ''));
  const speedMps = finiteNumber(record?.enhancedSpeed) ?? finiteNumber(record?.speed);
  const altitude = finiteNumber(record?.enhancedAltitude) ?? finiteNumber(record?.altitude);
  const latSemicircles = finiteNumber(record?.positionLat);
  const lonSemicircles = finiteNumber(record?.positionLong);
  return {
    timestampMs,
    distanceMeters: finiteNumber(record?.distance),
    speedKmh: speedMps === null ? null : speedMps * 3.6,
    heartRate: finiteNumber(record?.heartRate),
    cadence: finiteNumber(record?.cadence),
    altitude,
    latitude: latSemicircles === null ? null : latSemicircles * SEMICIRCLES_TO_DEGREES,
    longitude: lonSemicircles === null ? null : lonSemicircles * SEMICIRCLES_TO_DEGREES
  };
}

function aggregateRecordsByMinute(records) {
  const points = (Array.isArray(records) ? records : [])
    .map(normalizeRecord)
    .filter((point) => Number.isFinite(point.timestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const cadenceMedian = median(points.map((point) => point.cadence).filter((value) => value > 0));
  const cadenceMultiplier = cadenceMedian !== null && cadenceMedian < 100 ? 2 : 1;
  const buckets = new Map();
  let previousDistance = null;
  let previousTimestampMs = null;

  for (const point of points) {
    const bucketStartMs = Math.floor(point.timestampMs / 60000) * 60000;
    if (!buckets.has(bucketStartMs)) {
      buckets.set(bucketStartMs, {
        bucketStartMs, distance: 0, recordCount: 0,
        speedSum: 0, speedCount: 0, heartRateSum: 0, heartRateCount: 0,
        pitchSum: 0, pitchCount: 0, altitudeSum: 0, altitudeCount: 0,
        latitudeSum: 0, latitudeCount: 0, longitudeSum: 0, longitudeCount: 0
      });
    }
    const bucket = buckets.get(bucketStartMs);
    bucket.recordCount += 1;
    let distanceDelta = null;
    if (point.distanceMeters !== null && point.distanceMeters >= 0 && previousDistance !== null) {
      const delta = point.distanceMeters - previousDistance;
      if (delta > 0) {
        distanceDelta = delta;
        bucket.distance += delta;
      }
    }
    let speedKmh = point.speedKmh;
    if (speedKmh === null && distanceDelta !== null && previousTimestampMs !== null) {
      const elapsedSeconds = (point.timestampMs - previousTimestampMs) / 1000;
      if (elapsedSeconds > 0) speedKmh = (distanceDelta / elapsedSeconds) * 3.6;
    }
    if (speedKmh !== null && speedKmh >= 0) { bucket.speedSum += speedKmh; bucket.speedCount += 1; }
    if (point.heartRate !== null && point.heartRate > 0) { bucket.heartRateSum += point.heartRate; bucket.heartRateCount += 1; }
    if (point.cadence !== null && point.cadence > 0) { bucket.pitchSum += point.cadence * cadenceMultiplier; bucket.pitchCount += 1; }
    if (point.altitude !== null) { bucket.altitudeSum += point.altitude; bucket.altitudeCount += 1; }
    if (point.latitude !== null) { bucket.latitudeSum += point.latitude; bucket.latitudeCount += 1; }
    if (point.longitude !== null) { bucket.longitudeSum += point.longitude; bucket.longitudeCount += 1; }
    if (point.distanceMeters !== null && point.distanceMeters >= 0) previousDistance = point.distanceMeters;
    previousTimestampMs = point.timestampMs;
  }

  const chartData = Array.from(buckets.values()).sort((a, b) => a.bucketStartMs - b.bucketStartMs).map((bucket) => {
    const rawDistance = Number(bucket.distance.toFixed(1));
    const rawSpeed = bucket.speedCount > 0 ? Number((bucket.speedSum / bucket.speedCount).toFixed(1)) : 0;
    const durationSeconds = bucket.recordCount > 0 ? bucket.recordCount : 60;
    const distanceBasedSpeed = durationSeconds > 0 ? Number(((rawDistance / durationSeconds) * 3.6).toFixed(1)) : 0;
    const speedBasedDistance = rawSpeed > 0 ? Number(((rawSpeed * durationSeconds) / 3.6).toFixed(1)) : 0;
    const distanceDeviationRate = rawSpeed > 0 ? Math.abs(distanceBasedSpeed - rawSpeed) / rawSpeed : 0;
    const adjusted = distanceDeviationRate > MINUTE_DISTANCE_DEVIATION_THRESHOLD;
    const distance = adjusted ? speedBasedDistance : rawDistance;
    const speed = adjusted && durationSeconds > 0
      ? Number(((distance / durationSeconds) * 3.6).toFixed(1))
      : (rawSpeed || null);
    const pitch = bucket.pitchCount > 0 ? Math.round(bucket.pitchSum / bucket.pitchCount) : null;
    return {
      time: tokyoMinuteLabel(bucket.bucketStartMs),
      bucketStartMs: bucket.bucketStartMs,
      recordCount: bucket.recordCount,
      coverageSeconds: durationSeconds,
      distancePointDurationSeconds: durationSeconds,
      rawDistance,
      rawSpeed,
      distance,
      stride: pitch && distance > 0 ? Number(((distance * 100) / pitch).toFixed(1)) : null,
      speed,
      heartRate: bucket.heartRateCount > 0 ? Math.round(bucket.heartRateSum / bucket.heartRateCount) : null,
      pitch,
      altitude: bucket.altitudeCount > 0 ? Number((bucket.altitudeSum / bucket.altitudeCount).toFixed(1)) : null,
      latitude: bucket.latitudeCount > 0 ? Number((bucket.latitudeSum / bucket.latitudeCount).toFixed(7)) : null,
      longitude: bucket.longitudeCount > 0 ? Number((bucket.longitudeSum / bucket.longitudeCount).toFixed(7)) : null,
      distanceDeviationRate: Number((distanceDeviationRate * 100).toFixed(1)),
      distanceSource: adjusted ? 'speed-adjusted' : 'raw',
      speedSource: adjusted ? 'distance-adjusted' : 'raw'
    };
  });
  return { chartData, cadenceMedian, cadenceMultiplier, recordCount: points.length };
}

function buildRouteData(records, labelId) {
  const normalized = (Array.isArray(records) ? records : [])
    .map(normalizeRecord)
    .filter((point) => Number.isFinite(point.timestampMs))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const cadenceMedian = median(normalized.map((point) => point.cadence).filter((value) => value > 0));
  const cadenceMultiplier = cadenceMedian !== null && cadenceMedian < 100 ? 2 : 1;
  const located = normalized.filter((point) => (
    Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    (Number(point.latitude) !== 0 || Number(point.longitude) !== 0)
  ));
  if (located.length === 0) return null;
  const startTimeMs = located[0].timestampMs;
  const points = located.map((point) => ({
    elapsedSeconds: Math.max(0, Math.round((point.timestampMs - startTimeMs) / 1000)),
    timestampMs: point.timestampMs,
    latitude: point.latitude,
    longitude: point.longitude,
    distanceMeters: point.distanceMeters,
    speed: point.speedKmh === null ? null : Number(point.speedKmh.toFixed(3)),
    heartRate: point.heartRate,
    pitch: point.cadence !== null && point.cadence > 0 ? Math.round(point.cadence * cadenceMultiplier) : null,
    altitudeMeters: point.altitude
  }));
  return {
    source: 'coros_fit',
    runId: String(labelId || ''),
    startTimeMs,
    endTimeMs: points[points.length - 1].timestampMs,
    durationSeconds: points[points.length - 1].elapsedSeconds,
    points
  };
}

async function decodeFitRecords(fitPath) {
  const { Decoder, Stream } = await import('@garmin/fitsdk');
  const buffer = await fs.readFile(fitPath);
  const decoder = new Decoder(Stream.fromBuffer(buffer));
  if (!decoder.isFIT()) throw new Error('Invalid FIT signature');
  if (!decoder.checkIntegrity()) throw new Error('FIT integrity check failed');
  const { messages, errors } = decoder.read();
  if (Array.isArray(errors) && errors.length > 0) throw new Error(`FIT decode failed: ${errors.join('; ')}`);
  const records = Array.isArray(messages?.recordMesgs) ? messages.recordMesgs : [];
  if (records.length === 0) throw new Error('No FIT record messages found');
  return records;
}

async function importCorosFit({ fitPath, metadataPath, outputPath, routeOutputPath }) {
  const metadata = parseJsonText(await fs.readFile(metadataPath, 'utf8'));
  const records = await decodeFitRecords(fitPath);
  const aggregated = aggregateRecordsByMinute(records);
  const payload = {
    source: 'coros_fit', labelId: String(metadata.labelId || ''), sportType: Number(metadata.sportType),
    startTime: records[0]?.timestamp instanceof Date ? records[0].timestamp.toISOString() : String(records[0]?.timestamp || ''),
    originalFitPath: path.resolve(fitPath), generatedAt: new Date().toISOString(),
    fitSha256: String(metadata.fitSha256 || '').trim() || null,
    recordCount: aggregated.recordCount, cadenceMedian: aggregated.cadenceMedian,
    cadenceMultiplier: aggregated.cadenceMultiplier, chartData: aggregated.chartData
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(temporaryPath, outputPath);
  const routeData = buildRouteData(records, payload.labelId);
  if (routeData && routeOutputPath) {
    await fs.mkdir(path.dirname(routeOutputPath), { recursive: true });
    const routeTemporaryPath = `${routeOutputPath}.tmp`;
    await fs.writeFile(routeTemporaryPath, JSON.stringify(routeData, null, 2), 'utf8');
    await fs.rename(routeTemporaryPath, routeOutputPath);
  }
  payload.routePointCount = routeData?.points?.length || 0;
  payload.routeOutputPath = routeData && routeOutputPath ? path.resolve(routeOutputPath) : null;
  return payload;
}

module.exports = { MINUTE_DISTANCE_DEVIATION_THRESHOLD, aggregateRecordsByMinute, buildRouteData, decodeFitRecords, importCorosFit, normalizeRecord, parseJsonText };

const MIN_REST_SECONDS = 10;
const REST_MAX_SPEED_MPS = 1.0;
const MAX_SAMPLE_SECONDS = 5;

function sampleDurationSeconds(points, index) {
  if (index >= points.length - 1) return 1;
  const delta = (Number(points[index + 1]?.timestampMs) - Number(points[index]?.timestampMs)) / 1000;
  if (!Number.isFinite(delta) || delta <= 0) return 1;
  return Math.min(delta, MAX_SAMPLE_SECONDS);
}

function extractCompleteRestWindows(trackpoints = []) {
  const points = (Array.isArray(trackpoints) ? trackpoints : [])
    .filter((point) => Number.isFinite(Number(point?.timestampMs)))
    .sort((a, b) => Number(a.timestampMs) - Number(b.timestampMs));
  const windows = [];
  let current = null;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const hasSpeed = point.speedMps !== null && point.speedMps !== undefined && Number.isFinite(Number(point.speedMps));
    const hasCadence = point.cadence !== null && point.cadence !== undefined && Number.isFinite(Number(point.cadence));
    const durationSeconds = sampleDurationSeconds(points, index);
    const heartRate = point.heartRate !== null && point.heartRate !== undefined && Number.isFinite(Number(point.heartRate))
      ? Number(point.heartRate)
      : null;
    const isCompleteRest = hasSpeed && hasCadence
      && Number(point.speedMps) <= REST_MAX_SPEED_MPS
      && Number(point.cadence) <= 0;

    if (isCompleteRest) {
      if (!current) {
        current = {
          startTimestampMs: Number(point.timestampMs),
          durationSeconds: 0,
          startHeartRate: heartRate,
          endHeartRate: heartRate
        };
      }
      current.durationSeconds += durationSeconds;
      current.endTimestampMs = Number(point.timestampMs) + durationSeconds * 1000;
      if (heartRate !== null) {
        if (current.startHeartRate === null) current.startHeartRate = heartRate;
        current.endHeartRate = heartRate;
      }
    } else if (current) {
      if (current.durationSeconds >= MIN_REST_SECONDS) windows.push(current);
      current = null;
    }
  }
  if (current && current.durationSeconds >= MIN_REST_SECONDS) windows.push(current);

  return windows.map((window) => ({
    startTimestampMs: window.startTimestampMs,
    endTimestampMs: window.endTimestampMs,
    durationSeconds: Number(window.durationSeconds.toFixed(1)),
    startHeartRate: window.startHeartRate,
    endHeartRate: window.endHeartRate,
    heartRateChange: window.startHeartRate !== null && window.endHeartRate !== null
      ? Number((window.endHeartRate - window.startHeartRate).toFixed(1))
      : null
  }));
}

module.exports = { extractCompleteRestWindows };

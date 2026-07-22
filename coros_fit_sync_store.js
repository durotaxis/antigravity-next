const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const COROS_ROOT = path.join(__dirname, 'data', 'coros');
const FIT_DIR = path.join(COROS_ROOT, 'fit');
const METADATA_DIR = path.join(COROS_ROOT, 'metadata');
const DEFAULT_STATE_PATH = path.join(__dirname, 'data', 'run-comment', 'state', 'coros-sync-state.json');

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function ensureFitSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) throw new Error('FIT file is too small');
  const headerSize = buffer[0];
  if (headerSize < 12 || headerSize > buffer.length || buffer.subarray(8, 12).toString('ascii') !== '.FIT') {
    throw new Error('Invalid FIT signature');
  }
}

async function atomicWrite(targetPath, data, verifyTemporaryFile) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp.${process.pid}.${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, data);
    if (verifyTemporaryFile) await verifyTemporaryFile(temporaryPath);
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function requireText(value, field) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} is required`);
  return text;
}

function buildMetadata(activity, fitPath, fitBytes, downloadedAt) {
  const labelId = requireText(activity.labelId, 'labelId');
  const sportType = Number(activity.sportType);
  if (!Number.isFinite(sportType)) throw new Error('sportType is required');
  return {
    source: 'coros_fit',
    labelId,
    sportType,
    date: requireText(activity.date, 'date'),
    startTime: activity.startTime ?? activity.startTimestamp ?? null,
    endTime: activity.endTime ?? activity.endTimestamp ?? null,
    originalFitPath: fitPath,
    fitSha256: sha256(fitBytes),
    fitSizeBytes: fitBytes.length,
    downloadedAt,
    activityDetails: activity.activityDetails && typeof activity.activityDetails === 'object' ? activity.activityDetails : {}
  };
}

async function readState(statePath) {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function persistCorosFitActivity({ activity, fitBytes, statePath = DEFAULT_STATE_PATH, downloadedAt = new Date().toISOString() }) {
  ensureFitSignature(fitBytes);
  const labelId = requireText(activity.labelId, 'labelId');
  const date = requireText(activity.date, 'date');
  const fitPath = path.join(FIT_DIR, `${date}_${labelId}.fit`);
  const metadataPath = path.join(METADATA_DIR, `${date}_${labelId}.json`);

  await atomicWrite(fitPath, fitBytes, async (temporaryPath) => ensureFitSignature(await fs.readFile(temporaryPath)));
  const metadata = buildMetadata(activity, fitPath, fitBytes, downloadedAt);
  await atomicWrite(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);

  const state = await readState(statePath);
  state.version = Number(state.version) || 1;
  state.activityFingerprints = state.activityFingerprints && typeof state.activityFingerprints === 'object' ? state.activityFingerprints : {};
  const fingerprintInput = { ...metadata, downloadedAt: undefined };
  const activityFingerprint = sha256(JSON.stringify(canonicalize(fingerprintInput)));
  state.activityFingerprints[labelId] = activityFingerprint;
  state.lastProcessedActivityId = labelId;
  state.lastProcessedStartTimestamp = Number(activity.startTimestamp ?? activity.startTime) || null;
  state.updatedAt = downloadedAt;
  await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);

  return { fitPath, metadataPath, activityFingerprint, metadata };
}

module.exports = { FIT_DIR, METADATA_DIR, DEFAULT_STATE_PATH, ensureFitSignature, persistCorosFitActivity };

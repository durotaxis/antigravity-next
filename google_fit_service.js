const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const fs = require('fs').promises;
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

function toLocalDateString(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getLocalDayBounds(dateString) {
    const date = new Date(dateString);
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    return { start, end };
}

function toRfc3339(date) {
    return new Date(date).toISOString();
}

function getLocalDayRangeMs(dateString) {
    const [year, month, day] = String(dateString || '').split('-').map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return { startMs: NaN, endMs: NaN };
    }
    const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
    const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0).getTime();
    return { startMs: start, endMs: end };
}

function synthesizeIntradayBucketStartMs(dateString, timeText) {
    const [year, month, day] = String(dateString || '').split('-').map(Number);
    const match = String(timeText || '').trim().match(/^(\d{2}):(\d{2})$/);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !match) {
        return NaN;
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function normalizeIntradayCacheRows(dateString, rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => {
        const next = { ...(row || {}) };
        const existingStart = Number(next.bucketStartMs);
        if (!Number.isFinite(existingStart)) {
            const synthesizedStart = synthesizeIntradayBucketStartMs(dateString, next.time);
            if (Number.isFinite(synthesizedStart)) {
                next.bucketStartMs = synthesizedStart;
            }
        }
        const existingEnd = Number(next.bucketEndMs);
        const startMs = Number(next.bucketStartMs);
        if (!Number.isFinite(existingEnd) && Number.isFinite(startMs)) {
            next.bucketEndMs = startMs + 60000;
        }
        return next;
    });
}

function countActiveBuckets(buckets) {
    if (!Array.isArray(buckets) || buckets.length === 0) return 0;
    let active = 0;
    for (const bucket of buckets) {
        let hasSignal = false;
        for (const ds of (bucket.dataset || [])) {
            const sourceId = String(ds.dataSourceId || '');
            if (!sourceId.includes('step_count') && !sourceId.includes('distance') && !sourceId.includes('heart_rate') && !sourceId.includes('activity')) continue;
            for (const p of (ds.point || [])) {
                for (const v of (p.value || [])) {
                    if ((Number(v.intVal) || 0) > 0 || (Number(v.fpVal) || 0) > 0) {
                        hasSignal = true;
                        break;
                    }
                }
                if (hasSignal) break;
            }
            if (hasSignal) break;
        }
        if (hasSignal) active++;
    }
    return active;
}

async function fetchIntradayBuckets(dateString) {
    const CACHE_DIR = path.join(__dirname, 'storage', 'cache');
    const rawCacheFile = path.join(CACHE_DIR, `raw_buckets_${dateString}.json`);
    const isToday = dateString === toLocalDateString();
    let cachedBuckets = null;
    let activeBuckets = 0;

    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const rawCached = await fs.readFile(rawCacheFile, 'utf8');
        cachedBuckets = JSON.parse(rawCached);
        activeBuckets = countActiveBuckets(cachedBuckets);
        // Guard against stale/incomplete caches that can force false "Rest Day" output.
        // For past dates, cache can be trusted. For today, force refresh to avoid stale morning snapshot.
        if (!isToday && activeBuckets >= 5) {
            console.log(`[GoogleFit] Using RAW data from cache: ${rawCacheFile} (No API Hit, active=${activeBuckets})`);
            return cachedBuckets;
        }
        if (isToday && activeBuckets >= 5) {
            console.log(`[GoogleFit] Today's RAW cache found (active=${activeBuckets}). Refreshing from API: ${dateString}`);
        } else {
            console.warn(`[GoogleFit] RAW cache looks sparse (active=${activeBuckets}). Refreshing from API: ${dateString}`);
        }
    } catch (err) {
        console.log(`[GoogleFit] Raw cache miss for ${dateString}, calling API...`);
    }

    try {
        const auth = await authorize();
        const fitness = google.fitness({ version: 'v1', auth });

        const date = new Date(dateString);
        const startTimeMillis = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime();
        const endTimeMillis = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59).getTime();
        const bucketDuration = 60 * 1000;

        const requestBody = {
            aggregateBy: [
                { dataTypeName: 'com.google.step_count.delta' },
                { dataTypeName: 'com.google.distance.delta' },
                { dataTypeName: 'com.google.heart_rate.bpm' },
                { dataTypeName: 'com.google.activity.segment' }
            ],
            bucketByTime: { durationMillis: bucketDuration },
            startTimeMillis: startTimeMillis,
            endTimeMillis: endTimeMillis
        };

        const response = await fitness.users.dataset.aggregate({ userId: 'me', requestBody });
        const buckets = response.data.bucket || [];
        const nextActive = countActiveBuckets(buckets);

        if (buckets.length > 0) {
            await fs.writeFile(rawCacheFile, JSON.stringify(buckets, null, 2));
            console.log(`[GoogleFit] Saved RAW data to cache: ${rawCacheFile} (active=${nextActive})`);
        } else {
            console.warn(`[GoogleFit] API returned empty raw buckets for ${dateString} (today=${isToday}).`);
        }

        // If API returned no useful buckets, keep prior cache as fallback.
        if (nextActive <= 0 && cachedBuckets && activeBuckets > 0) {
            console.warn(`[GoogleFit] Falling back to previous RAW cache for ${dateString} (active=${activeBuckets}).`);
            return cachedBuckets;
        }
        return buckets;
    } catch (err) {
        if (cachedBuckets && activeBuckets > 0) {
            console.warn(`[GoogleFit] API fetch failed for ${dateString}. Falling back to RAW cache (active=${activeBuckets}): ${err.message}`);
            return cachedBuckets;
        }
        throw err;
    }
}

async function fetchSessionsForDate(dateString) {
    const CACHE_DIR = path.join(__dirname, 'storage', 'cache');
    const sessionsCacheFile = path.join(CACHE_DIR, `sessions_${dateString}.json`);
    const isToday = dateString === toLocalDateString();
    let cachedSessions = null;

    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const rawCached = await fs.readFile(sessionsCacheFile, 'utf8');
        cachedSessions = JSON.parse(rawCached);
        if (!isToday && Array.isArray(cachedSessions)) {
            console.log(`[GoogleFit] Using session cache: ${sessionsCacheFile} (${cachedSessions.length} sessions)`);
            return cachedSessions;
        }
        if (isToday) {
            console.log(`[GoogleFit] Today's session cache found. Refreshing from API: ${dateString}`);
        }
    } catch (err) {
        console.log(`[GoogleFit] Session cache miss for ${dateString}, calling API...`);
    }

    try {
        const auth = await authorize();
        const fitness = google.fitness({ version: 'v1', auth });
        const { start, end } = getLocalDayBounds(dateString);
        const sessions = [];
        let pageToken = null;

        do {
            const response = await fitness.users.sessions.list({
                userId: 'me',
                startTime: toRfc3339(start),
                endTime: toRfc3339(end),
                pageToken: pageToken || undefined
            });
            const pageSessions = Array.isArray(response?.data?.session) ? response.data.session : [];
            sessions.push(...pageSessions);
            pageToken = response?.data?.nextPageToken || null;
        } while (pageToken);

        await fs.writeFile(sessionsCacheFile, JSON.stringify(sessions, null, 2));
        console.log(`[GoogleFit] Saved sessions to cache: ${sessionsCacheFile} (${sessions.length} sessions)`);
        return sessions;
    } catch (err) {
        if (cachedSessions && Array.isArray(cachedSessions)) {
            console.warn(`[GoogleFit] Session API fetch failed for ${dateString}. Falling back to session cache: ${err.message}`);
            return cachedSessions;
        }
        throw err;
    }
}

async function fetchSessionsForRange(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return [];
    }
    const auth = await authorize();
    const fitness = google.fitness({ version: 'v1', auth });
    const sessions = [];
    let pageToken = null;
    do {
        const response = await fitness.users.sessions.list({
            userId: 'me',
            startTime: toRfc3339(startMs),
            endTime: toRfc3339(endMs),
            pageToken: pageToken || undefined
        });
        const pageSessions = Array.isArray(response?.data?.session) ? response.data.session : [];
        sessions.push(...pageSessions);
        pageToken = response?.data?.nextPageToken || null;
    } while (pageToken);
    return sessions;
}

async function fetchIntradayBucketsForRange(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return [];
    }
    const auth = await authorize();
    const fitness = google.fitness({ version: 'v1', auth });
    const requestBody = {
        aggregateBy: [
            { dataTypeName: 'com.google.step_count.delta' },
            { dataTypeName: 'com.google.distance.delta' },
            { dataTypeName: 'com.google.heart_rate.bpm' },
            { dataTypeName: 'com.google.activity.segment' }
        ],
        bucketByTime: { durationMillis: 60 * 1000 },
        startTimeMillis: Math.floor(startMs),
        endTimeMillis: Math.floor(endMs)
    };
    const response = await fitness.users.dataset.aggregate({ userId: 'me', requestBody });
    return Array.isArray(response?.data?.bucket) ? response.data.bucket : [];
}

async function getDetailedFitSpeedSeries(dateString) {
    const CACHE_DIR = path.join(__dirname, 'storage', 'cache');
    const speedCacheFile = path.join(CACHE_DIR, `fit_speed_full_${dateString}.json`);
    const isToday = dateString === toLocalDateString();
    let cached = null;

    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const rawCached = await fs.readFile(speedCacheFile, 'utf8');
        cached = JSON.parse(rawCached);
        if (!isToday && Array.isArray(cached?.points)) {
            return cached;
        }
    } catch {
        // cache miss; fetch from API
    }

    const auth = await authorize();
    const fitness = google.fitness({ version: 'v1', auth });
    const dsResp = await fitness.users.dataSources.list({ userId: 'me' });
    const allSources = Array.isArray(dsResp?.data?.dataSource) ? dsResp.data.dataSource : [];
    const speedSource = allSources.find((ds) => {
        const dataTypeName = String(ds?.dataType?.name || '').toLowerCase();
        const streamId = String(ds?.dataStreamId || '').toLowerCase();
        return dataTypeName === 'com.google.speed' && streamId.includes('merge_speed');
    });

    if (!speedSource) {
        const empty = { date: dateString, dataSourceId: null, pointCount: 0, points: [] };
        await fs.writeFile(speedCacheFile, JSON.stringify(empty, null, 2));
        return empty;
    }

    const { startMs: dayStart, endMs: dayEnd } = getLocalDayRangeMs(dateString);
    if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayEnd <= dayStart) {
        const empty = { date: dateString, dataSourceId: speedSource.dataStreamId, pointCount: 0, points: [] };
        await fs.writeFile(speedCacheFile, JSON.stringify(empty, null, 2));
        return empty;
    }
    const datasetId = `${dayStart * 1000000}-${dayEnd * 1000000}`;
    const resp = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: speedSource.dataStreamId,
        datasetId
    });

    const points = (Array.isArray(resp?.data?.point) ? resp.data.point : []).filter((point) => {
        const pointMs = nanosToMillis(point?.startTimeNanos);
        return Number.isFinite(pointMs) && pointMs >= dayStart && pointMs < dayEnd;
    });

    const out = {
        date: dateString,
        dataSourceId: speedSource.dataStreamId,
        pointCount: points.length,
        points
    };
    await fs.writeFile(speedCacheFile, JSON.stringify(out, null, 2));
    return out;
}

async function getDetailedFitSpeedSeriesForRange(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return { date: '', dataSourceId: null, pointCount: 0, points: [] };
    }
    const auth = await authorize();
    const fitness = google.fitness({ version: 'v1', auth });
    const dsResp = await fitness.users.dataSources.list({ userId: 'me' });
    const allSources = Array.isArray(dsResp?.data?.dataSource) ? dsResp.data.dataSource : [];
    const speedSource = allSources.find((ds) => {
        const dataTypeName = String(ds?.dataType?.name || '').toLowerCase();
        const streamId = String(ds?.dataStreamId || '').toLowerCase();
        return dataTypeName === 'com.google.speed' && streamId.includes('merge_speed');
    });
    if (!speedSource) {
        return { date: '', dataSourceId: null, pointCount: 0, points: [] };
    }
    const datasetId = `${Math.floor(startMs) * 1000000}-${Math.floor(endMs) * 1000000}`;
    const resp = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: speedSource.dataStreamId,
        datasetId
    });
    const points = (Array.isArray(resp?.data?.point) ? resp.data.point : []).filter((point) => {
        const pointMs = nanosToMillis(point?.startTimeNanos);
        return Number.isFinite(pointMs) && pointMs >= startMs && pointMs < endMs;
    });
    return {
        date: '',
        dataSourceId: speedSource.dataStreamId,
        pointCount: points.length,
        points
    };
}

async function getDetailedFitHeartRateSeries(dateString) {
    const CACHE_DIR = path.join(__dirname, 'storage', 'cache');
    const hrCacheFile = path.join(CACHE_DIR, `fit_hr_full_${dateString}.json`);
    const isToday = dateString === toLocalDateString();
    let cached = null;

    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const rawCached = await fs.readFile(hrCacheFile, 'utf8');
        cached = JSON.parse(rawCached);
        if (!isToday && Array.isArray(cached?.points)) {
            return cached;
        }
    } catch {
        // cache miss; fetch from API
    }

    const auth = await authorize();
    const fitness = google.fitness({ version: 'v1', auth });
    const dsResp = await fitness.users.dataSources.list({ userId: 'me' });
    const allSources = Array.isArray(dsResp?.data?.dataSource) ? dsResp.data.dataSource : [];
    const hrSource = allSources.find((ds) => {
        const dataTypeName = String(ds?.dataType?.name || '').toLowerCase();
        const streamId = String(ds?.dataStreamId || '').toLowerCase();
        return dataTypeName === 'com.google.heart_rate.bpm' && streamId.includes('merge_heart_rate_bpm');
    });

    if (!hrSource) {
        const empty = { date: dateString, dataSourceId: null, pointCount: 0, points: [] };
        await fs.writeFile(hrCacheFile, JSON.stringify(empty, null, 2));
        return empty;
    }

    const { startMs: dayStart, endMs: dayEnd } = getLocalDayRangeMs(dateString);
    if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayEnd <= dayStart) {
        const empty = { date: dateString, dataSourceId: hrSource.dataStreamId, pointCount: 0, points: [] };
        await fs.writeFile(hrCacheFile, JSON.stringify(empty, null, 2));
        return empty;
    }
    const datasetId = `${dayStart * 1000000}-${dayEnd * 1000000}`;
    const resp = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: hrSource.dataStreamId,
        datasetId
    });

    const points = (Array.isArray(resp?.data?.point) ? resp.data.point : []).filter((point) => {
        const pointMs = nanosToMillis(point?.startTimeNanos);
        return Number.isFinite(pointMs) && pointMs >= dayStart && pointMs < dayEnd;
    });

    const out = {
        date: dateString,
        dataSourceId: hrSource.dataStreamId,
        pointCount: points.length,
        points
    };
    await fs.writeFile(hrCacheFile, JSON.stringify(out, null, 2));
    return out;
}

async function getDetailedFitHeartRateSeriesForRange(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return { date: '', dataSourceId: null, pointCount: 0, points: [] };
    }
    const auth = await authorize();
    const fitness = google.fitness({ version: 'v1', auth });
    const dsResp = await fitness.users.dataSources.list({ userId: 'me' });
    const allSources = Array.isArray(dsResp?.data?.dataSource) ? dsResp.data.dataSource : [];
    const hrSource = allSources.find((ds) => {
        const dataTypeName = String(ds?.dataType?.name || '').toLowerCase();
        const streamId = String(ds?.dataStreamId || '').toLowerCase();
        return dataTypeName === 'com.google.heart_rate.bpm' && streamId.includes('merge_heart_rate_bpm');
    });
    if (!hrSource) {
        return { date: '', dataSourceId: null, pointCount: 0, points: [] };
    }
    const datasetId = `${Math.floor(startMs) * 1000000}-${Math.floor(endMs) * 1000000}`;
    const resp = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: hrSource.dataStreamId,
        datasetId
    });
    const points = (Array.isArray(resp?.data?.point) ? resp.data.point : []).filter((point) => {
        const pointMs = nanosToMillis(point?.startTimeNanos);
        return Number.isFinite(pointMs) && pointMs >= startMs && pointMs < endMs;
    });
    return {
        date: '',
        dataSourceId: hrSource.dataStreamId,
        pointCount: points.length,
        points
    };
}

async function getDetailedFitPitchSeries(dateString) {
    const CACHE_DIR = path.join(__dirname, 'storage', 'cache');
    const pitchCacheFile = path.join(CACHE_DIR, `fit_pitch_full_${dateString}.json`);
    const isToday = dateString === toLocalDateString();
    let cached = null;

    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const rawCached = await fs.readFile(pitchCacheFile, 'utf8');
        cached = JSON.parse(rawCached);
        if (!isToday && Array.isArray(cached?.points)) {
            return cached;
        }
    } catch {
        // cache miss; fetch from API
    }

    const auth = await authorize();
    const fitness = google.fitness({ version: 'v1', auth });
    const dsResp = await fitness.users.dataSources.list({ userId: 'me' });
    const allSources = Array.isArray(dsResp?.data?.dataSource) ? dsResp.data.dataSource : [];
    const stepSource = allSources.find((ds) => {
        const dataTypeName = String(ds?.dataType?.name || '').toLowerCase();
        const streamId = String(ds?.dataStreamId || '').toLowerCase();
        return dataTypeName === 'com.google.step_count.delta' && streamId.includes('merge_step_deltas');
    }) || allSources.find((ds) => {
        const dataTypeName = String(ds?.dataType?.name || '').toLowerCase();
        const streamId = String(ds?.dataStreamId || '').toLowerCase();
        return dataTypeName === 'com.google.step_count.delta' && streamId.includes('estimated_steps');
    });

    if (!stepSource) {
        const empty = { date: dateString, dataSourceId: null, pointCount: 0, points: [] };
        await fs.writeFile(pitchCacheFile, JSON.stringify(empty, null, 2));
        return empty;
    }

    const { startMs: dayStart, endMs: dayEnd } = getLocalDayRangeMs(dateString);
    if (!Number.isFinite(dayStart) || !Number.isFinite(dayEnd) || dayEnd <= dayStart) {
        const empty = { date: dateString, dataSourceId: stepSource.dataStreamId, pointCount: 0, points: [] };
        await fs.writeFile(pitchCacheFile, JSON.stringify(empty, null, 2));
        return empty;
    }
    const datasetId = `${dayStart * 1000000}-${dayEnd * 1000000}`;
    const resp = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: stepSource.dataStreamId,
        datasetId
    });

    const points = (Array.isArray(resp?.data?.point) ? resp.data.point : []).filter((point) => {
        const startMs = nanosToMillis(point?.startTimeNanos);
        const endMs = nanosToMillis(point?.endTimeNanos);
        const steps = Number(point?.value?.[0]?.intVal || 0);
        if (!(steps > 0)) return false;
        return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs && startMs < dayEnd && endMs > dayStart;
    });

    const out = {
        date: dateString,
        dataSourceId: stepSource.dataStreamId,
        pointCount: points.length,
        points
    };
    await fs.writeFile(pitchCacheFile, JSON.stringify(out, null, 2));
    return out;
}

async function getDetailedFitPitchSeriesForRange(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return { date: '', dataSourceId: null, pointCount: 0, points: [] };
    }
    const auth = await authorize();
    const fitness = google.fitness({ version: 'v1', auth });
    const dsResp = await fitness.users.dataSources.list({ userId: 'me' });
    const allSources = Array.isArray(dsResp?.data?.dataSource) ? dsResp.data.dataSource : [];
    const stepSource = allSources.find((ds) => {
        const dataTypeName = String(ds?.dataType?.name || '').toLowerCase();
        const streamId = String(ds?.dataStreamId || '').toLowerCase();
        return dataTypeName === 'com.google.step_count.delta' && streamId.includes('merge_step_deltas');
    }) || allSources.find((ds) => {
        const dataTypeName = String(ds?.dataType?.name || '').toLowerCase();
        const streamId = String(ds?.dataStreamId || '').toLowerCase();
        return dataTypeName === 'com.google.step_count.delta' && streamId.includes('estimated_steps');
    });
    if (!stepSource) {
        return { date: '', dataSourceId: null, pointCount: 0, points: [] };
    }
    const datasetId = `${Math.floor(startMs) * 1000000}-${Math.floor(endMs) * 1000000}`;
    const resp = await fitness.users.dataSources.datasets.get({
        userId: 'me',
        dataSourceId: stepSource.dataStreamId,
        datasetId
    });
    const points = (Array.isArray(resp?.data?.point) ? resp.data.point : []).filter((point) => {
        const pointStartMs = nanosToMillis(point?.startTimeNanos);
        const pointEndMs = nanosToMillis(point?.endTimeNanos);
        const steps = Number(point?.value?.[0]?.intVal || 0);
        if (!(steps > 0)) return false;
        return Number.isFinite(pointStartMs) && Number.isFinite(pointEndMs) && pointEndMs > pointStartMs && pointStartMs < endMs && pointEndMs > startMs;
    });
    return {
        date: '',
        dataSourceId: stepSource.dataStreamId,
        pointCount: points.length,
        points
    };
}

/**
 * Authenticate with Google Fit API
 */
async function authorize() {
    try {
        const content = await fs.readFile(CREDENTIALS_PATH);
        const credentials = JSON.parse(content);
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

        try {
            const token = await fs.readFile(TOKEN_PATH);
            oAuth2Client.setCredentials(JSON.parse(token));
            return oAuth2Client;
        } catch (err) {
            if (err && err.code !== 'ENOENT') {
                throw err;
            }
        }

        // No token yet. Trigger local auth flow and persist token.json.
        const client = await authenticate({
            keyfilePath: CREDENTIALS_PATH,
            scopes: [
                'https://www.googleapis.com/auth/fitness.activity.read',
                'https://www.googleapis.com/auth/fitness.location.read',
                'https://www.googleapis.com/auth/fitness.body.read',
                'https://www.googleapis.com/auth/fitness.heart_rate.read'
            ],
            authOptions: { access_type: 'offline', prompt: 'consent' }
        });
        await fs.writeFile(TOKEN_PATH, JSON.stringify(client.credentials));
        return client;
    } catch (error) {
        console.error('Error loading client secret or token:', error);
        throw new Error('Google Fit Authentication Failed');
    }
}

async function deleteTokenFile() {
    try {
        await fs.unlink(TOKEN_PATH);
        console.warn('[GoogleFit] token.json deleted due to invalid_grant');
    } catch (err) {
        if (err && err.code !== 'ENOENT') {
            console.warn(`[GoogleFit] Failed to delete token.json: ${err.message}`);
        }
    }
}

/**
 * Fetch Daily Metrics (Steps, Distance, Calories, Heart Rate) for a specific date
 * @param {string} dateString 'YYYY-MM-DD'
 */
async function getDailyMetrics(dateString) {
    try {
        const auth = await authorize();
        const fitness = google.fitness({ version: 'v1', auth });

        // Calculate start and end time in nanoseconds
        const date = new Date(dateString);
        // Set to local start of day (00:00:00) - Careful with timezone!
        // Assuming the dateString is local YYYY-MM-DD, processing in system locale
        const startTimeMillis = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime();
        const endTimeMillis = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59).getTime();

        const requestBody = {
            aggregateBy: [
                { dataTypeName: 'com.google.step_count.delta' },
                { dataTypeName: 'com.google.distance.delta' },
                { dataTypeName: 'com.google.calories.expended' },
                { dataTypeName: 'com.google.heart_rate.bpm' }
            ],
            bucketByTime: { durationMillis: endTimeMillis - startTimeMillis },
            startTimeMillis: startTimeMillis,
            endTimeMillis: endTimeMillis
        };

        console.log('Fit API Request:', JSON.stringify(requestBody, null, 2));

        const response = await fitness.users.dataset.aggregate({
            userId: 'me',
            requestBody
        });

        const bucket = response.data.bucket[0];
        if (!bucket || !bucket.dataset) {
            console.log('No bucket data found for date:', dateString);
            return null;
        }

        let steps = 0;
        let distance = 0;
        let calories = 0;
        let avgHR = 0;
        let maxHR = 0;

        bucket.dataset.forEach(ds => {
            if (ds.point && ds.point.length > 0) {
                ds.point.forEach(p => {
                    p.value.forEach(v => {
                        // Steps
                        if (ds.dataSourceId.includes('step_count')) {
                            steps += (v.intVal || 0);
                        }
                        // Distance
                        if (ds.dataSourceId.includes('distance')) {
                            distance += (v.fpVal || 0);
                        }
                        // Calories
                        if (ds.dataSourceId.includes('calories')) {
                            calories += (v.fpVal || 0);
                        }
                        // Heart Rate
                        if (ds.dataSourceId.includes('heart_rate')) {
                            if (v.fpVal) {
                                // This aggregation usually returns avg, max, min if bucketed?
                                // Standard heart_rate.bpm is instantaneous. 
                                // Since we aggregated, let's check values provided.
                                // Typically we might get multiple points if not aggregated properly or averages.
                                // For simplicity if simplified aggregation:
                                avgHR = v.fpVal; // Placeholder
                            }
                        }
                    });
                });
            }
        });

        // Refine HR extraction - The above loop merges types. 
        // Let's iterate explicitly by type if needed or trust the aggregation API structure.
        // Google Fit Aggregate response structure is tricky.
        // Let's map properly based on index in `aggregateBy` request.

        const stepDataset = bucket.dataset.find(d => d.dataSourceId.includes('step_count'));
        const distDataset = bucket.dataset.find(d => d.dataSourceId.includes('distance'));
        const calDataset = bucket.dataset.find(d => d.dataSourceId.includes('calories'));
        const hrDataset = bucket.dataset.find(d => d.dataSourceId.includes('heart_rate'));

        if (stepDataset) steps = sumIntValues(stepDataset);
        if (distDataset) distance = sumFpValues(distDataset);
        if (calDataset) calories = sumFpValues(calDataset);

        // HR is special - we want Avg and Max.
        // If we aggregate by time=1day, we get ONE point with computed values if we ask for it?
        // Actually `com.google.heart_rate.bpm` aggregation results in avg, max, min fields if supported?
        // Let's assume for now we just get what we can. 
        // If we want Max/Avg HR specifically, we should check `com.google.heart_rate.summary` data type if available
        // But let's check what `com.google.heart_rate.bpm` gives in aggregate.
        // Usually it gives average.
        if (hrDataset) {
            const val = getFpValue(hrDataset);
            if (val) avgHR = val;
            // Max HR is hard to get from simple daily aggregate of bpm unless using summary type. 
            // We will default Max to Avg * 1.2 or similar estimate if not found, or 0.
        }

        // Stride Calculation (Estimation)
        // distance (m) * 100 / steps = stride (cm)
        let avgStride = 0;
        if (steps > 0) {
            avgStride = (distance * 100) / steps;
        }

        // --- FETCH INTRADAY DATA TO FIND REAL MAX VALUES & RECALCULATE AVERAGES ---
        // Instead of using the 24h raw aggregate, we will RECALCULATE the daily averages
        // based on the CLEANED running segments from getIntradayMetrics.
        // This ensures the "Avg HR" and "Avg Stride" on the card match the filtered chart.

        const intraday = await getIntradayMetricsWithMeta(dateString);
        const intradayData = intraday.data;
        let realMaxHR = 0;
        let realMaxStride = 0;

        // Recalculated Averages (Filtered)
        let filteredAvgHR = 0;
        let filteredAvgStride = 0;
        let filteredAvgCadence = 0;
        let realMaxCadence = 0;
        let realMaxSpeed = 0;

        // Unfiltered max speed is computed from raw 1-min buckets inside getIntradayMetricsWithMeta.
        const unfilteredMaxSpeed = intraday.unfilteredMaxSpeed || 0;

        if (intradayData && intradayData.length > 0) {
            // calculate averages from valid points only
            let sumHR = 0;
            let countHR = 0;
            let sumStride = 0;
            let countStride = 0;
            let sumCadence = 0;
            let countCadence = 0;

            intradayData.forEach(d => {
                // Find Max
                if (d.heartRate > realMaxHR) realMaxHR = d.heartRate;
                if (d.stride > realMaxStride) realMaxStride = d.stride;
                if (d.steps > realMaxCadence) realMaxCadence = d.steps;
                if (d.speed > realMaxSpeed) realMaxSpeed = d.speed;

                // Accumulate for Average
                if (d.heartRate > 0) {
                    sumHR += d.heartRate;
                    countHR++;
                }
                if (d.stride > 0) {
                    sumStride += d.stride;
                    countStride++;
                }
                if (d.steps > 0) {
                    sumCadence += d.steps;
                    countCadence++;
                }
            });

            if (countHR > 0) filteredAvgHR = Math.round(sumHR / countHR);
            if (countStride > 0) filteredAvgStride = parseFloat((sumStride / countStride).toFixed(1));
            if (countCadence > 0) filteredAvgCadence = Math.round(sumCadence / countCadence);

            // Sanity Check: If Max is 0 but Avg > 0, something is wrong with the loop or data types
            if (realMaxStride === 0 && filteredAvgStride > 0) {
                console.warn('[Metric Warning] Max Stride is 0 but Avg is positive! Force updating Max to at least Avg.');
                let tempMax = 0;
                intradayData.forEach(d => { if (d.stride > tempMax) tempMax = d.stride; });
                realMaxStride = tempMax;
            }

            console.log(`[Metrics] Recalculated from Intraday: MaxHR=${realMaxHR}, MaxStride=${realMaxStride}, AvgHR=${filteredAvgHR}, AvgStride=${filteredAvgStride}, Cadence=${filteredAvgCadence}`);
        } else {
            console.log(`[Metrics] No Intraday data found. Max values will be 0.`);
        }

        if (unfilteredMaxSpeed > realMaxSpeed) realMaxSpeed = unfilteredMaxSpeed;

        // Use filtered averages if available, otherwise fallback to raw 24h aggregate
        const finalAvgHR = (filteredAvgHR > 0) ? filteredAvgHR : Math.round(avgHR);
        const finalAvgStride = (filteredAvgStride > 0) ? filteredAvgStride : parseFloat(avgStride.toFixed(1));

        return {
            date: dateString,
            step_count: Math.round(steps),
            total_distance_km: parseFloat((distance / 1000).toFixed(2)),
            total_time: '00:00:00',
            avg_heart_rate: finalAvgHR,
            max_heart_rate: Math.round(realMaxHR),
            calories_kcal: Math.round(calories),
            avg_stride_cm: finalAvgStride,
            max_stride_cm: parseFloat(realMaxStride.toFixed(1)),
            avg_cadence: filteredAvgCadence,
            max_cadence: realMaxCadence,
            max_speed: parseFloat(realMaxSpeed.toFixed(1))
        };

    } catch (err) {
        const apiMsg = err?.response?.data?.error?.message || err?.message || '';
        if (apiMsg.includes('invalid_grant')) {
            await deleteTokenFile();
            throw new Error('Google Fit token expired. token.json deleted. Re-auth required.');
        }
        if (err.response && err.response.data && err.response.data.error) {
            console.error('API Error Message:', err.response.data.error.message);
            console.error('API Error Code:', err.response.data.error.code);
        } else if (err.errors) {
            console.error('API Errors:', JSON.stringify(err.errors, null, 2));
        } else {
            console.error('API Error:', err.message);
        }
        throw err;
    }
}

/**
 * Clean and Filter Intraday Data
 * - Keep run-labeled points
 * - Interpolate Spikes/Drops (0 or >100 jump)
 * - Exclude Stride > 250cm
 */
function cleanIntradayData(rawData) {
    if (!rawData || rawData.length === 0) return [];

    // 1. Sort by full timestamp only.
    // If older rows do not carry sortable timestamp fields, preserve input order
    // instead of inventing chronology from display-only HH:mm strings.
    rawData.sort((a, b) => {
        const aStart = Number(a?.bucketStartMs);
        const bStart = Number(b?.bucketStartMs);
        if (Number.isFinite(aStart) && Number.isFinite(bStart)) return aStart - bStart;
        return 0;
    });

    const cleaned = [];

    for (let i = 0; i < rawData.length; i++) {
        let point = { ...rawData[i] };

        // --- A. Interpolation (Spike/Zero Detection) ---
        // Checks Heart Rate and Stride for anomalies
        if (shouldInterpolate(point, rawData, i)) {
            point = interpolatePoint(rawData, i);
        }

        // --- B. Stride Ceiling ---
        // Physiologically unlikely threshold
        if (point.stride > 250) {
            point.stride = 0; // Invalidate stride
        }

        // Only keep points that have SOME valid data
        if (point.steps > 0 || point.heartRate > 0) {
            // Valid Running Filter: Eliminate "phone walking" noise if needed
            // (For now, we trust the cache data source filtering if implemented in getIntradayMetrics,
            // but here we ensure data quality)
            cleaned.push(point);
        }
    }
    return cleaned;
}

function shouldInterpolate(point, allData, index) {
    // 1. Zero Drop (Heart Rate) but active steps
    if (point.heartRate === 0 && point.steps > 10) return true;

    // 2. Impossible Jump (e.g., > 80bpm difference from neighbors)
    if (index > 0 && index < allData.length - 1) {
        const prev = allData[index - 1];
        if (prev.heartRate > 0 && Math.abs(point.heartRate - prev.heartRate) > 80) return true;
    }
    return false;
}

function interpolatePoint(allData, index) {
    const point = { ...allData[index] };
    const prev = (index > 0) ? allData[index - 1] : null;
    const next = (index < allData.length - 1) ? allData[index + 1] : null;

    // Simple Linear Interpolation
    if (prev && next && prev.heartRate > 0 && next.heartRate > 0) {
        point.heartRate = Math.round((prev.heartRate + next.heartRate) / 2);
    } else if (prev && prev.heartRate > 0) {
        point.heartRate = prev.heartRate;
    } else if (next && next.heartRate > 0) {
        point.heartRate = next.heartRate;
    }
    // If neighbors are empty, leave as is (cannot rescue)
    return point;
}


/**
 * Helper: Calculate Simple Moving Average (SMA)
 */
function calculateSMA(data, windowSize) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        // For the beginning of the array where we don't have enough points,
        // we can either duplicate the first value or average available leading points.
        // Charts look better if we just average what we have.
        let sum = 0;
        let count = 0;
        for (let j = 0; j < windowSize; j++) {
            if (i - j >= 0) {
                sum += data[i - j];
                count++;
            }
        }
        sma.push((count > 0) ? sum / count : data[i]);
    }
    return sma;
}

function normalizeRunSessions(sessions) {
    if (!Array.isArray(sessions)) return [];
    return sessions
        .map((session) => ({
            startMs: Number(session?.startTimeMillis),
            endMs: Number(session?.endTimeMillis),
            activityType: Number(session?.activityType)
        }))
        .filter((session) =>
            Number.isFinite(session.startMs) &&
            Number.isFinite(session.endMs) &&
            session.endMs > session.startMs &&
            session.activityType === 8
        )
        .sort((a, b) => a.startMs - b.startMs);
}

function calculateCoverageSeconds(bucketStartMs, bucketEndMs, runSessions) {
    if (!Number.isFinite(bucketStartMs) || !Number.isFinite(bucketEndMs) || bucketEndMs <= bucketStartMs) return null;
    if (!Array.isArray(runSessions) || runSessions.length === 0) return null;

    let overlapMillis = 0;
    runSessions.forEach((session) => {
        const overlapStart = Math.max(bucketStartMs, session.startMs);
        const overlapEnd = Math.min(bucketEndMs, session.endMs);
        if (overlapEnd > overlapStart) {
            overlapMillis += (overlapEnd - overlapStart);
        }
    });

    if (!(overlapMillis > 0)) return null;
    return Number((overlapMillis / 1000).toFixed(1));
}

function nanosToMillis(nanosValue) {
    const nanos = Number(nanosValue);
    if (!Number.isFinite(nanos) || nanos <= 0) return null;
    return Math.floor(nanos / 1000000);
}

function durationSecondsFromPoint(point) {
    const startMs = nanosToMillis(point?.startTimeNanos);
    const endMs = nanosToMillis(point?.endTimeNanos);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;
    return Number(((endMs - startMs) / 1000).toFixed(3));
}

function processIntradayBuckets(buckets, sessions = []) {
    const chartData = [];
    let unfilteredMaxSpeed = 0;
    const runSessions = normalizeRunSessions(sessions);

    (buckets || []).forEach(bucket => {
        const bucketStartMs = Number.parseInt(bucket?.startTimeMillis, 10);
        const bucketEndMs = Number.parseInt(bucket?.endTimeMillis, 10);
        const time = Number.isFinite(bucketStartMs)
            ? new Date(bucketStartMs).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })
            : '00:00';
        const datasets = Array.isArray(bucket?.dataset) ? bucket.dataset : [];

        let steps = 0;
        let distance = 0;
        let heartRate = 0;
        let isRunningActivity = false;
        let bucketDistanceAll = 0;
        let distancePointDurationSeconds = 0;
        let stepsPointDurationSeconds = 0;

        datasets.forEach(ds => {
            const sourceId = ds.dataSourceId || '';
            if (ds.point && ds.point.length > 0) {
                ds.point.forEach(p => {
                    const dataTypeName = String(p.dataTypeName || '').toLowerCase();
                    const pointValues = Array.isArray(p.value) ? p.value : [];
                    const summaryActivityType = Number(pointValues?.[0]?.intVal);
                    const pointDurationSeconds = durationSecondsFromPoint(p);
                    if (
                        (dataTypeName.includes('activity.summary') || sourceId.includes('activity.summary')) &&
                        summaryActivityType === 8
                    ) {
                        isRunningActivity = true;
                    }
                    pointValues.forEach(v => {
                        if (sourceId.includes('step_count')) {
                            steps += (v.intVal || 0);
                            if (pointDurationSeconds > 0) stepsPointDurationSeconds += pointDurationSeconds;
                        }
                        if (sourceId.includes('distance')) {
                            const dist = (v.fpVal || 0);
                            distance += dist;
                            bucketDistanceAll += dist;
                            if (pointDurationSeconds > 0) distancePointDurationSeconds += pointDurationSeconds;
                        }
                        // Current behavior intentionally keeps the last heart_rate.summary value
                        // until the meaning/order of the value array is verified.
                        if (sourceId.includes('heart_rate')) heartRate = (v.fpVal || v.intVal || 0);
                        if (
                            (dataTypeName.includes('activity.segment') || sourceId.includes('activity.segment')) &&
                            v.intVal === 8
                        ) {
                            isRunningActivity = true;
                        }
                    });
                });
            }
        });

        // coverageSeconds is retained as session/bucket overlap metadata.
        // If distance/steps values represent the whole point range, speed/pitch should prefer
        // point duration instead of dividing by overlap seconds directly.
        // A future strict session-only path can prorate point values to this overlap when needed.
        const coverageSeconds = calculateCoverageSeconds(bucketStartMs, bucketEndMs, runSessions);

        if (bucketDistanceAll > 0) {
            const speedAny = distancePointDurationSeconds > 0
                ? parseFloat(((bucketDistanceAll / distancePointDurationSeconds) * 3.6).toFixed(1))
                : parseFloat((bucketDistanceAll * 0.06).toFixed(1));
            if (speedAny > unfilteredMaxSpeed) unfilteredMaxSpeed = speedAny;
        }

        let stride = 0;
        if (steps > 0) stride = (distance * 100) / steps;

        let speed = 0;
        if (distance > 0) {
            speed = distancePointDurationSeconds > 0
                ? parseFloat(((distance / distancePointDurationSeconds) * 3.6).toFixed(1))
                : parseFloat((distance * 0.06).toFixed(1));
        }
        const pitch = steps > 0
            ? (stepsPointDurationSeconds > 0
                ? parseFloat(((steps / stepsPointDurationSeconds) * 60).toFixed(1))
                : steps)
            : 0;

        // Keep only buckets explicitly labeled as running (activity.segment/activity.summary = 8).
        if ((steps > 0 || heartRate > 0) && isRunningActivity) {
            chartData.push({
                time,
                bucketStartMs: Number.isFinite(bucketStartMs) ? bucketStartMs : null,
                bucketEndMs: Number.isFinite(bucketEndMs) ? bucketEndMs : null,
                coverageSeconds: coverageSeconds > 0 ? coverageSeconds : null,
                distancePointDurationSeconds: distancePointDurationSeconds > 0 ? distancePointDurationSeconds : null,
                stepsPointDurationSeconds: stepsPointDurationSeconds > 0 ? stepsPointDurationSeconds : null,
                steps,
                pitch,
                distance: parseFloat(distance.toFixed(1)),
                stride: parseFloat(stride.toFixed(1)), heartRate: Math.round(heartRate),
                speed,
                source: 'cache'
            });
        }
    });

    // No smoothing: keep the same series for detail table and metric calculations.
    const cleanedData = cleanIntradayData(chartData);
    const smoothedData = cleanedData;

    return {
        chartData,
        smoothedData,
        unfilteredMaxSpeed
    };
}

async function getIntradayMetricsWithMeta(dateString) {
    const CACHE_DIR = path.join(__dirname, 'storage', 'cache');
    const finalCacheFile = path.join(CACHE_DIR, `intraday_${dateString}.json`);
    let sessions = [];

    try {
        sessions = await fetchSessionsForDate(dateString);
    } catch (err) {
        console.warn(`[GoogleFit] Session cache refresh failed for ${dateString}: ${err.message}`);
    }

    let buckets;
    try {
        buckets = await fetchIntradayBuckets(dateString);
    } catch (err) {
        const apiMsg = err?.response?.data?.error?.message || err?.message || '';
        if (apiMsg.includes('invalid_grant')) {
            await deleteTokenFile();
            console.error('Intraday API Error: invalid_grant (token.json deleted)');
        } else {
            console.error('Intraday API Error:', err.message);
        }
        // If API fails, try falling back to the processed cache if it exists
        try {
            const finalCached = await fs.readFile(finalCacheFile, 'utf8');
            const cached = normalizeIntradayCacheRows(dateString, JSON.parse(finalCached));
            try {
                await fs.writeFile(finalCacheFile, JSON.stringify(cached, null, 2));
            } catch {
                // best-effort upgrade only
            }
            const cachedMaxSpeed = (cached || []).reduce((max, p) => Math.max(max, Number(p?.speed) || 0), 0);
            return {
                data: cached,
                unfilteredMaxSpeed: cachedMaxSpeed
            };
        } catch (e) {
            try {
                await fs.writeFile(finalCacheFile, JSON.stringify([], null, 2));
                console.warn(`[GoogleFit] API failed and no intraday cache found. Wrote empty cache: ${finalCacheFile}`);
            } catch {
                // best-effort only
            }
            return {
                data: [],
                unfilteredMaxSpeed: 0
            };
        }
    }

    const processed = processIntradayBuckets(buckets, sessions);

    if ((processed.chartData || []).length > 0) {
        await fs.writeFile(finalCacheFile, JSON.stringify(processed.chartData, null, 2));
    } else {
        console.warn(`[GoogleFit] Processed intraday chart data is empty for ${dateString}.`);
        // Keep existing non-empty cache to avoid overwriting valid historical data on sparse API responses.
        let keepExisting = false;
        try {
            const existingRaw = await fs.readFile(finalCacheFile, 'utf8');
            const existing = normalizeIntradayCacheRows(dateString, JSON.parse(existingRaw));
            if (Array.isArray(existing) && existing.length > 0) {
                keepExisting = true;
                console.log(`[GoogleFit] Keeping existing intraday cache for ${dateString} (${existing.length} points).`);
                try {
                    await fs.writeFile(finalCacheFile, JSON.stringify(existing, null, 2));
                } catch {
                    // best-effort upgrade only
                }
            }
        } catch {
            // no existing cache
        }

        // Create an explicit empty cache marker so sync flow can complete deterministically.
        if (!keepExisting) {
            await fs.writeFile(finalCacheFile, JSON.stringify([], null, 2));
            console.log(`[GoogleFit] Wrote empty intraday cache: ${finalCacheFile}`);
        }
    }

    return {
        data: processed.smoothedData,
        unfilteredMaxSpeed: processed.unfilteredMaxSpeed
    };
}

/**
 * Fetch Intraday Metrics for Chart (15-min buckets)
 * @param {string} dateString 'YYYY-MM-DD'
 */
async function getIntradayMetrics(dateString) {
    const result = await getIntradayMetricsWithMeta(dateString);
    return result.data;
}

function sumIntValues(dataset) {
    let sum = 0;
    if (dataset.point) {
        dataset.point.forEach(p => {
            if (p.value) p.value.forEach(v => sum += (v.intVal || 0));
        });
    }
    return sum;
}

function sumFpValues(dataset) {
    let sum = 0;
    if (dataset.point) {
        dataset.point.forEach(p => {
            if (p.value) p.value.forEach(v => sum += (v.fpVal || 0));
        });
    }
    return sum;
}

function getFpValue(dataset) {
    if (dataset.point && dataset.point.length > 0) {
        if (dataset.point[0].value && dataset.point[0].value.length > 0) {
            return dataset.point[0].value[0].fpVal || dataset.point[0].value[0].intVal || 0;
        }
    }
    return 0;
}

module.exports = {
    getDailyMetrics,
    getIntradayMetrics,
    fetchSessionsForDate,
    fetchSessionsForRange,
    fetchIntradayBucketsForRange,
    getDetailedFitSpeedSeries,
    getDetailedFitSpeedSeriesForRange,
    getDetailedFitHeartRateSeries,
    getDetailedFitHeartRateSeriesForRange,
    getDetailedFitPitchSeries,
    getDetailedFitPitchSeriesForRange,
    normalizeIntradayCacheRows,
    processIntradayBuckets
};

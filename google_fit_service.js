const { google } = require('googleapis');
const { authenticate } = require('@google-cloud/local-auth');
const fs = require('fs').promises;
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

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

    try {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        const rawCached = await fs.readFile(rawCacheFile, 'utf8');
        const buckets = JSON.parse(rawCached);
        const activeBuckets = countActiveBuckets(buckets);
        // Guard against stale/incomplete caches that can force false "Rest Day" output.
        if (activeBuckets >= 5) {
            console.log(`[GoogleFit] Using RAW data from cache: ${rawCacheFile} (No API Hit, active=${activeBuckets})`);
            return buckets;
        }
        console.warn(`[GoogleFit] RAW cache looks sparse (active=${activeBuckets}). Refreshing from API: ${dateString}`);
    } catch (err) {
        console.log(`[GoogleFit] Raw cache miss for ${dateString}, calling API...`);
    }

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

    if (buckets.length > 0) {
        await fs.writeFile(rawCacheFile, JSON.stringify(buckets, null, 2));
        console.log(`[GoogleFit] Saved RAW data to cache: ${rawCacheFile}`);
    }

    return buckets;
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

        const intradayData = await getIntradayMetrics(dateString);
        let realMaxHR = 0;
        let realMaxStride = 0;

        // Recalculated Averages (Filtered)
        let filteredAvgHR = 0;
        let filteredAvgStride = 0;
        let filteredAvgCadence = 0;
        let realMaxCadence = 0;
        let realMaxSpeed = 0;

        // Max Speed should be based on the per-minute distance deltas (unfiltered),
        // otherwise strict chart filtering can incorrectly produce 0.
        let unfilteredMaxSpeed = 0;
        try {
            const buckets = await fetchIntradayBuckets(dateString);
            buckets.forEach(bucket => {
                let bucketDistance = 0;
                (bucket.dataset || []).forEach(ds => {
                    const sourceId = ds.dataSourceId || '';
                    if (!sourceId.includes('distance')) return;
                    if (ds.point && ds.point.length > 0) {
                        ds.point.forEach(p => {
                            (p.value || []).forEach(v => { bucketDistance += (v.fpVal || 0); });
                        });
                    }
                });

                if (bucketDistance > 0) {
                    // 1-minute bucket assumption: speed(km/h) = distance(m) * 0.06
                    const speed = parseFloat((bucketDistance * 0.06).toFixed(1));
                    if (speed > unfilteredMaxSpeed) unfilteredMaxSpeed = speed;
                }
            });
        } catch (e) {
            // Non-fatal: fallback to chart-derived max speed.
            console.warn('[Metrics] Failed to compute unfiltered max speed:', e.message);
        }

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

            // Debug Logging
            console.log(`[Metric Debug] CountStride=${countStride}, SumStride=${sumStride}`);
            console.log(`[Metric Debug] RealMaxStride=${realMaxStride}, FilteredAvgStride=${filteredAvgStride}`);
            console.log(`[Metric Debug] MaxCadence=${realMaxCadence}, AvgCadence=${filteredAvgCadence}`);

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
 * - Filter by Source (TicWatch / Running)
 * - Interpolate Spikes/Drops (0 or >100 jump)
 * - Exclude Stride > 250cm
 */
function cleanIntradayData(rawData) {
    if (!rawData || rawData.length === 0) return [];

    // 1. Sort by time just in case
    rawData.sort((a, b) => a.time.localeCompare(b.time));

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

/**
 * Fetch Intraday Metrics for Chart (15-min buckets)
 * @param {string} dateString 'YYYY-MM-DD'
 */
async function getIntradayMetrics(dateString) {
    const CACHE_DIR = path.join(__dirname, 'storage', 'cache');
    const finalCacheFile = path.join(CACHE_DIR, `intraday_${dateString}.json`);

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
            return JSON.parse(finalCached);
        } catch (e) {
            return [];
        }
    }

    // --- PROCESSING (Always runs, can use raw cache or fresh API data) ---
    const chartData = [];

    buckets.forEach(bucket => {
        const timeMillis = parseInt(bucket.startTimeMillis);
        const time = new Date(timeMillis).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

        let steps = 0;
        let distance = 0;
        let heartRate = 0;
        let isRunningActivity = false;
        let isTicWatch = false;

        bucket.dataset.forEach(ds => {
            const sourceId = ds.dataSourceId || '';
            if (ds.point && ds.point.length > 0) {
                const isWatchOrSync =
                    sourceId.toLowerCase().includes('mobvoi') ||
                    sourceId.toLowerCase().includes('ticwatch') ||
                    sourceId.toLowerCase().includes('watch') ||
                    sourceId.toLowerCase().includes('wear') ||
                    sourceId.toLowerCase().includes('android') ||
                    sourceId.toLowerCase().includes('heart_rate');

                if (isWatchOrSync) isTicWatch = true;

                ds.point.forEach(p => {
                    p.value.forEach(v => {
                        if (sourceId.includes('step_count')) steps += (v.intVal || 0);
                        if (sourceId.includes('distance')) distance += (v.fpVal || 0);
                        if (sourceId.includes('heart_rate')) heartRate = (v.fpVal || v.intVal || 0);
                        if (sourceId.includes('activity.segment') && v.intVal === 8) isRunningActivity = true;
                    });
                });
            }
        });

        let stride = 0;
        if (steps > 0) stride = (distance * 100) / steps;

        // Speed Calculation (km/h)
        // distance (m) -> km / 1000
        // time (1 min) -> hour / 60
        // speed = (distance/1000) / (1/60) = (distance * 60) / 1000 = distance * 0.06
        // NOTE: This assumes 1-minute buckets!
        let speed = 0;
        if (distance > 0) {
            speed = parseFloat((distance * 0.06).toFixed(1));
        }

        // HYBRID FILTER LOGIC
        const isHighIntensity = heartRate > 100;
        if ((steps > 0 || heartRate > 0) && isTicWatch && (isRunningActivity || isHighIntensity)) {
            chartData.push({
                time, steps, distance: parseFloat(distance.toFixed(1)),
                stride: parseFloat(stride.toFixed(1)), heartRate: Math.round(heartRate),
                speed, // Add speed
                source: 'ticwatch'
            });
        }
    });

    // Save final processed data to cache
    if (chartData.length > 0) {
        await fs.writeFile(finalCacheFile, JSON.stringify(chartData, null, 2));
    }

    // Cleaning & Smoothing
    const cleanedData = cleanIntradayData(chartData);
    const strideArray = cleanedData.map(d => d.stride);
    const hrArray = cleanedData.map(d => d.heartRate);
    const smoothedStride = calculateSMA(strideArray, 5);
    const smoothedHR = calculateSMA(hrArray, 5);

    return cleanedData.map((d, i) => ({
        ...d,
        stride: parseFloat(smoothedStride[i].toFixed(1)),
        heartRate: Math.round(smoothedHR[i])
    }));
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

module.exports = { getDailyMetrics, getIntradayMetrics };

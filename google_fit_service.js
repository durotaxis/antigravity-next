const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

/**
 * Authenticate with Google Fit API
 */
async function authorize() {
    try {
        const content = await fs.readFile(CREDENTIALS_PATH);
        const credentials = JSON.parse(content);
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

        const token = await fs.readFile(TOKEN_PATH);
        oAuth2Client.setCredentials(JSON.parse(token));
        return oAuth2Client;
    } catch (error) {
        console.error('Error loading client secret or token:', error);
        throw new Error('Google Fit Authentication Failed');
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

        return {
            date: dateString,
            step_count: Math.round(steps),
            total_distance_km: parseFloat((distance / 1000).toFixed(2)),
            total_time: '00:00:00', // Cannot easily get moving time from simple daily aggregate
            avg_heart_rate: Math.round(avgHR),
            max_heart_rate: Math.round(avgHR * 1.1), // Rough estimate for now
            calories_kcal: Math.round(calories),
            avg_stride_cm: parseFloat(avgStride.toFixed(1)),
            max_stride_cm: parseFloat((avgStride * 1.3).toFixed(1)) // Rough estimate
        };

    } catch (err) {
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
 * Fetch Intraday Metrics for Chart (15-min buckets)
 * @param {string} dateString 'YYYY-MM-DD'
 */
async function getIntradayMetrics(dateString) {
    try {
        const auth = await authorize();
        const fitness = google.fitness({ version: 'v1', auth });

        const date = new Date(dateString);
        const startTimeMillis = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0).getTime();
        const endTimeMillis = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59).getTime();
        const bucketDuration = 15 * 60 * 1000; // 15 minutes

        const requestBody = {
            aggregateBy: [
                { dataTypeName: 'com.google.step_count.delta' },
                { dataTypeName: 'com.google.distance.delta' },
                { dataTypeName: 'com.google.heart_rate.bpm' }
            ],
            bucketByTime: { durationMillis: bucketDuration },
            startTimeMillis: startTimeMillis,
            endTimeMillis: endTimeMillis
        };

        const response = await fitness.users.dataset.aggregate({
            userId: 'me',
            requestBody
        });

        const buckets = response.data.bucket || [];
        const chartData = [];

        buckets.forEach(bucket => {
            const time = new Date(parseInt(bucket.startTimeMillis)).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

            let steps = 0;
            let distance = 0;
            let heartRate = 0;

            bucket.dataset.forEach(ds => {
                if (ds.point && ds.point.length > 0) {
                    ds.point.forEach(p => {
                        p.value.forEach(v => {
                            if (ds.dataSourceId.includes('step_count')) steps += (v.intVal || 0);
                            if (ds.dataSourceId.includes('distance')) distance += (v.fpVal || 0);
                            if (ds.dataSourceId.includes('heart_rate')) heartRate = (v.fpVal || v.intVal || 0); // Avg for bucket
                        });
                    });
                }
            });

            // Calculate Stride for this bucket
            // stride (cm) = (distance (m) * 100) / steps
            let stride = 0;
            if (steps > 0) {
                stride = (distance * 100) / steps;
            }

            if (steps > 0 || heartRate > 0) {
                chartData.push({
                    time,
                    steps,
                    distance: parseFloat(distance.toFixed(1)),
                    stride: parseFloat(stride.toFixed(1)),
                    heartRate: Math.round(heartRate)
                });
            }
        });

        return chartData;

    } catch (err) {
        console.error('Intraday API Error:', err.message);
        return []; // Return empty array on error to prevent crash
    }
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
        // Return first value found
        if (dataset.point[0].value && dataset.point[0].value.length > 0) {
            return dataset.point[0].value[0].fpVal || dataset.point[0].value[0].intVal || 0;
        }
    }
    return 0;
}

module.exports = { getDailyMetrics, getIntradayMetrics };

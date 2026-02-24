const WR_STRIDE = 200.0;
const LEGACY_OPENAI_TOGGLE_STORAGE_KEY = 'useGeminiApi';
const OPENAI_TOGGLE_STORAGE_KEY = 'useOpenAiAdviceApi';
const GEMINI_TOGGLE_STORAGE_KEY = 'useGeminiAdviceApi';
const ADVICE_PROVIDER_STORAGE_KEY = 'adviceProvider';
const RUN_DATE_STORAGE_KEY = 'selectedRunDate';
const SNAPSHOT_DATE_STORAGE_KEY = 'selectedSnapshotDate';
const FIT_SYNC_FROM_DATE_STORAGE_KEY = 'fitSyncFromDate';
const DEBUG_ANCHOR_DATE_STORAGE_KEY = 'debugAnchorDate';
const FIT_SYNC_CHECKPOINT_DATE_STORAGE_KEY = 'fitSyncCheckpointDate';
const IMAGE_IMPORT_CHECKPOINT_DATE_STORAGE_KEY = 'imageImportCheckpointDate';
const batchSelectedFiles = new Set();
let latestBatchRunToken = 0;

function getSelectedAdviceProvider() {
    const selected = document.querySelector('input[name="adviceProvider"]:checked');
    return selected ? String(selected.value || '').trim() : '';
}

function isOpenAiEnabled() {
    return getSelectedAdviceProvider() === 'openai';
}

function isGeminiEnabled() {
    return getSelectedAdviceProvider() === 'gemini';
}

function restoreAdviceToggles() {
    const openAiToggle = document.getElementById('openaiAdviceToggle');
    const geminiToggle = document.getElementById('geminiAdviceToggle');
    if (!openAiToggle || !geminiToggle) return;

    const providerSaved = localStorage.getItem(ADVICE_PROVIDER_STORAGE_KEY);
    if (providerSaved === 'openai' || providerSaved === 'gemini') {
        openAiToggle.checked = providerSaved === 'openai';
        geminiToggle.checked = providerSaved === 'gemini';
        return;
    }

    const openAiSaved = localStorage.getItem(OPENAI_TOGGLE_STORAGE_KEY);
    const openAiLegacy = localStorage.getItem(LEGACY_OPENAI_TOGGLE_STORAGE_KEY);
    const geminiSaved = localStorage.getItem(GEMINI_TOGGLE_STORAGE_KEY);
    if (geminiSaved === '1') {
        openAiToggle.checked = false;
        geminiToggle.checked = true;
    } else if (openAiSaved === null) {
        openAiToggle.checked = openAiLegacy === null ? true : openAiLegacy === '1';
        geminiToggle.checked = false;
    } else {
        openAiToggle.checked = openAiSaved === '1';
        geminiToggle.checked = !openAiToggle.checked;
    }
}

function bindAdviceToggles() {
    const toggles = document.querySelectorAll('input[name="adviceProvider"]');
    if (!toggles || toggles.length === 0) return;

    toggles.forEach(toggle => {
        toggle.addEventListener('change', () => {
            const provider = getSelectedAdviceProvider();
            if (provider === 'openai' || provider === 'gemini') {
                localStorage.setItem(ADVICE_PROVIDER_STORAGE_KEY, provider);
                localStorage.setItem(OPENAI_TOGGLE_STORAGE_KEY, provider === 'openai' ? '1' : '0');
                localStorage.setItem(GEMINI_TOGGLE_STORAGE_KEY, provider === 'gemini' ? '1' : '0');
            }
        });
    });
}

function isValidRunDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function normalizeRunDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const normalized = raw.replace(/\//g, '-');
    return isValidRunDate(normalized) ? normalized : '';
}

function getTodayLocalDateString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function restoreRunDateInput() {
    const dateInput = document.getElementById('dateInput');
    if (!dateInput) return;

    const params = new URLSearchParams(window.location.search || '');
    const fromQuery = String(params.get('date') || '').trim();
    if (isValidRunDate(fromQuery)) {
        dateInput.value = fromQuery;
        localStorage.setItem(RUN_DATE_STORAGE_KEY, fromQuery);
        return;
    }

    const saved = localStorage.getItem(RUN_DATE_STORAGE_KEY);
    const initial = isValidRunDate(saved) ? saved : getTodayLocalDateString();
    dateInput.value = initial;
}

function persistRunDateInput() {
    const dateInput = document.getElementById('dateInput');
    if (!dateInput) return;
    const value = String(dateInput.value || '').trim();
    if (!isValidRunDate(value)) return;
    localStorage.setItem(RUN_DATE_STORAGE_KEY, value);
}

function restoreSnapshotDateInput() {
    const snapshotInput = document.getElementById('snapshotDateInput');
    const runDateInput = document.getElementById('dateInput');
    if (!snapshotInput) return;
    const saved = localStorage.getItem(SNAPSHOT_DATE_STORAGE_KEY);
    const fallback = runDateInput ? String(runDateInput.value || '').trim() : '';
    const initial = isValidRunDate(saved) ? saved : (isValidRunDate(fallback) ? fallback : '');
    snapshotInput.value = initial;
}

function persistSnapshotDateInput() {
    const snapshotInput = document.getElementById('snapshotDateInput');
    if (!snapshotInput) return;
    const value = String(snapshotInput.value || '').trim();
    if (!isValidRunDate(value)) return;
    localStorage.setItem(SNAPSHOT_DATE_STORAGE_KEY, value);
}

function restoreFitSyncFromDateInput() {
    const fromInput = document.getElementById('fitSyncFromDateInput');
    if (!fromInput) return;
    const saved = String(localStorage.getItem(FIT_SYNC_FROM_DATE_STORAGE_KEY) || '').trim();
    const initial = isValidRunDate(saved) ? saved : getTodayLocalDateString();
    fromInput.value = initial;
}

function persistFitSyncFromDateInput() {
    const fromInput = document.getElementById('fitSyncFromDateInput');
    if (!fromInput) return;
    const value = normalizeRunDate(fromInput.value);
    if (!value) return;
    localStorage.setItem(FIT_SYNC_FROM_DATE_STORAGE_KEY, value);
}

function restoreHeightInput() {
    const input = document.getElementById('heightCmInput');
    if (!input) return;
    const saved = String(localStorage.getItem('profile.height_cm') || '').trim();
    if (/^\d{3}$/.test(saved)) {
        input.value = saved;
    }
}

function saveHeightInput() {
    const input = document.getElementById('heightCmInput');
    if (!input) return;
    const raw = String(input.value || '').trim();
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 100 || v > 250) {
        alert('Height must be between 100 and 250 cm.');
        return;
    }
    const rounded = String(Math.round(v));
    input.value = rounded;
    localStorage.setItem('profile.height_cm', rounded);
}

function compareDateText(a, b) {
    return String(a || '').localeCompare(String(b || ''));
}

function nextDateText(dateText) {
    const [y, m, d] = String(dateText).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    const yyyy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function listDateRange(fromDate, toDate) {
    const out = [];
    let cur = fromDate;
    while (compareDateText(cur, toDate) <= 0) {
        out.push(cur);
        cur = nextDateText(cur);
    }
    return out;
}

function getStoredValidDate(key) {
    const v = String(localStorage.getItem(key) || '').trim();
    return isValidRunDate(v) ? v : '';
}

function markDebugAnchorDate(dateValue) {
    const d = normalizeRunDate(dateValue);
    if (!d) return;
    localStorage.setItem(DEBUG_ANCHOR_DATE_STORAGE_KEY, d);
    updateDebugHints();
}

function getDebugAnchorDate() {
    const saved = getStoredValidDate(DEBUG_ANCHOR_DATE_STORAGE_KEY);
    if (saved) return saved;
    const fitSyncFromInput = document.getElementById('fitSyncFromDateInput');
    const fromFitSync = fitSyncFromInput ? normalizeRunDate(fitSyncFromInput.value) : '';
    return fromFitSync || getTodayLocalDateString();
}

function getPendingDateRange(checkpointKey) {
    const today = getTodayLocalDateString();
    const anchor = getDebugAnchorDate();
    const checkpoint = getStoredValidDate(checkpointKey);
    let start = anchor;
    if (checkpoint && compareDateText(checkpoint, start) >= 0) {
        start = nextDateText(checkpoint);
    }
    if (compareDateText(start, today) > 0) return [];
    return listDateRange(start, today);
}

function getPendingDateRangeWithFrom(checkpointKey, fromDate) {
    const today = getTodayLocalDateString();
    const checkpoint = getStoredValidDate(checkpointKey);
    const manualFrom = normalizeRunDate(fromDate);
    let start = manualFrom || getDebugAnchorDate();
    // Manual "From Date" is treated as explicit override.
    // When specified, do not skip by checkpoint.
    if (!manualFrom && checkpoint && compareDateText(checkpoint, start) >= 0) {
        start = nextDateText(checkpoint);
    }
    if (compareDateText(start, today) > 0) return [];
    return listDateRange(start, today);
}

function updateDebugHints() {
    const anchor = getDebugAnchorDate();
    const fitCheckpoint = getStoredValidDate(FIT_SYNC_CHECKPOINT_DATE_STORAGE_KEY) || '-';
    const imageCheckpoint = getStoredValidDate(IMAGE_IMPORT_CHECKPOINT_DATE_STORAGE_KEY) || '-';
    const fitRange = getPendingDateRange(FIT_SYNC_CHECKPOINT_DATE_STORAGE_KEY);
    const imageRange = getPendingDateRange(IMAGE_IMPORT_CHECKPOINT_DATE_STORAGE_KEY);

    const fitHint = document.getElementById('fitSyncHint');
    if (fitHint) {
        fitHint.textContent = `anchor ${anchor} / checkpoint ${fitCheckpoint} / pending ${fitRange.length}`;
    }
    const imageHint = document.getElementById('imageImportHint');
    if (imageHint) {
        imageHint.textContent = `anchor ${anchor} / checkpoint ${imageCheckpoint} / pending ${imageRange.length}`;
    }
}

async function syncFitJsonRangeFromUi() {
    const syncBtn = document.getElementById('syncJsonBtn');
    const fromInput = document.getElementById('fitSyncFromDateInput');
    const manualFrom = fromInput ? normalizeRunDate(fromInput.value) : '';
    if (manualFrom) {
        markDebugAnchorDate(manualFrom);
    }
    const dates = getPendingDateRangeWithFrom(FIT_SYNC_CHECKPOINT_DATE_STORAGE_KEY, manualFrom);
    if (dates.length === 0) {
        // If user explicitly chose a date, allow one-day sync even when checkpoint logic yields no range.
        if (!manualFrom) {
            alert('No pending FIT dates.');
            return;
        }
    }
    const targetDates = dates.length > 0 ? dates : [manualFrom];

    let okCount = 0;
    let ngCount = 0;
    let lastSuccess = '';
    let firstFailure = '';
    let firstFailureReason = '';
    const originalText = syncBtn ? syncBtn.textContent : '';

    if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.textContent = `SYNCING 0/${targetDates.length}`;
    }

    try {
        for (let i = 0; i < targetDates.length; i++) {
            const d = targetDates[i];
            try {
                const res = await fetch(`/api/stride?date=${encodeURIComponent(d)}&sync=1`);
                if (!res.ok) {
                    let detail = '';
                    try {
                        const body = await res.json();
                        detail = body && body.error ? String(body.error) : '';
                    } catch {
                        // ignore non-JSON error body
                    }
                    throw new Error(detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`);
                }
                await res.json();
                okCount += 1;
                lastSuccess = d;
            } catch (e) {
                ngCount += 1;
                firstFailure = d;
                firstFailureReason = e && e.message ? String(e.message) : '';
                break;
            }
            if (syncBtn) syncBtn.textContent = `SYNCING ${i + 1}/${targetDates.length}`;
        }
    } finally {
        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.textContent = originalText || 'SYNC FIT JSON';
        }
    }

    if (lastSuccess) {
        localStorage.setItem(FIT_SYNC_CHECKPOINT_DATE_STORAGE_KEY, lastSuccess);
    }
    updateDebugHints();
    if (firstFailure) {
        const suffix = firstFailureReason ? `\nreason: ${firstFailureReason}` : '';
        alert(`FIT sync stopped at ${firstFailure}. success ${okCount}, failed ${ngCount}${suffix}`);
    } else {
        alert(`FIT sync completed: success ${okCount}, failed ${ngCount}`);
    }
    loadData({ triggerAdvice: false });
}

function setBatchPickerMessage(message) {
    const picker = document.getElementById('batchImagePicker');
    if (!picker) return;
    picker.textContent = message;
}

function renderBatchImagePicker(images) {
    const picker = document.getElementById('batchImagePicker');

    batchSelectedFiles.clear();
    if (!Array.isArray(images) || images.length === 0) {
        if (picker) {
            picker.innerHTML = '';
            setBatchPickerMessage('No linked images for this date. Add manual filename or link image first.');
        }
        return;
    }

    if (picker) picker.innerHTML = '';

    images.forEach((img) => {
        const filename = String(img && img.stored_filename ? img.stored_filename : '').trim();
        const originalName = String(img && img.original_filename ? img.original_filename : '').trim();
        const snapshotDate = String(img && img.snapshot_date ? img.snapshot_date : '').trim();
        if (!filename) return;
        batchSelectedFiles.add(filename);

        if (picker) {
            const row = document.createElement('div');
            row.className = 'batch-image-item';
            const label = originalName || filename;
            row.textContent = snapshotDate ? `${snapshotDate} | ${label}` : label;
            if (originalName && originalName !== filename) {
                row.title = filename;
            }
            picker.appendChild(row);
        }
    });
}

async function loadBatchImageCandidates() {
    const snapshotInput = document.getElementById('snapshotDateInput');
    const snapshotDate = snapshotInput ? normalizeRunDate(snapshotInput.value) : '';
    const dateInput = document.getElementById('dateInput');
    const runDate = dateInput ? normalizeRunDate(dateInput.value) : '';
    const targetDate = snapshotDate || runDate;
    if (!targetDate) {
        setBatchPickerMessage('Date is required.');
        return;
    }

    setBatchPickerMessage('Loading images...');
    try {
        const qs = new URLSearchParams({ date: targetDate });
        if (snapshotDate) qs.set('snapshot_date', snapshotDate);
        const res = await fetch(`/api/images/candidates?${qs.toString()}`);
        if (!res.ok) throw new Error(`Failed to load images: ${res.status}`);
        const imagesRaw = await res.json();
        const linkedImages = Array.isArray(imagesRaw)
            ? imagesRaw.filter((row) => Number(row && row.linked) === 1)
            : [];
        const images = isValidRunDate(snapshotDate)
            ? linkedImages.filter((row) => String(row && row.snapshot_date ? row.snapshot_date : '').trim() === snapshotDate)
            : linkedImages;
        renderBatchImagePicker(images);
    } catch (err) {
        setBatchPickerMessage(`Image load error: ${err.message}`);
    }
}

function normalizeDigitsOnly(text) {
    return String(text || '').replace(/[^0-9]/g, '');
}

async function importInboxImagesForBatchDate() {
    const dateInput = document.getElementById('dateInput');
    const runDate = dateInput ? String(dateInput.value || '').trim() : '';
    const snapshotInput = document.getElementById('snapshotDateInput');
    const snapshotDate = snapshotInput ? String(snapshotInput.value || '').trim() : '';
    const targetDate = isValidRunDate(snapshotDate) ? snapshotDate : runDate;
    if (!targetDate) {
        setBatchPickerMessage('Date is required.');
        return { imported: 0, matched: 0 };
    }

    const tokenSource = targetDate;
    const targetToken = normalizeDigitsOnly(tokenSource);
    if (!targetToken) {
        setBatchPickerMessage('Invalid date.');
        return { imported: 0, matched: 0 };
    }

    const inboxRes = await fetch('/api/inbox/files');
    if (!inboxRes.ok) throw new Error(`Failed to load inbox files: ${inboxRes.status}`);
    const inboxFiles = await inboxRes.json();
    const allFiles = Array.isArray(inboxFiles) ? inboxFiles : [];

    const matchedFiles = allFiles.filter(name => normalizeDigitsOnly(name).includes(targetToken));
    if (matchedFiles.length === 0) {
        return { imported: 0, matched: 0 };
    }

    const importRes = await fetch(`/api/runs/${encodeURIComponent(targetDate)}/import-selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filenames: matchedFiles,
            skipAdvice: !isGeminiEnabled(),
            skipSummary: true
        })
    });
    if (!importRes.ok) {
        throw new Error(`Import failed: ${importRes.status}`);
    }

    const importData = await importRes.json();
    const resultRows = Array.isArray(importData && importData.results) ? importData.results : [];
    const imported = resultRows.filter(r => r && r.status === 'success').length;
    return { imported, matched: matchedFiles.length };
}

async function handleBatchLoadImages() {
    const snapshotInput = document.getElementById('snapshotDateInput');
    const snapshotDate = snapshotInput ? String(snapshotInput.value || '').trim() : '';
    const dateInput = document.getElementById('dateInput');
    const runDate = dateInput ? String(dateInput.value || '').trim() : '';
    const targetDate = isValidRunDate(snapshotDate) ? snapshotDate : runDate;
    try {
        setBatchPickerMessage('Importing from Phone Link...');
        const imported = await importInboxImagesForBatchDate();
        await loadBatchImageCandidates();
        if (targetDate) markDebugAnchorDate(targetDate);
        renderBatchResult({
            mode: 'batch-load',
            run_date: targetDate || null,
            snapshot_date: isValidRunDate(snapshotDate) ? snapshotDate : targetDate || null,
            imported_from_inbox: imported.imported,
            matched_inbox_files: imported.matched
        });
        return { targetDate, imported: imported.imported, matched: imported.matched };
    } catch (err) {
        setBatchPickerMessage(`Batch load error: ${err.message}`);
        return { targetDate, imported: 0, matched: 0, error: err.message };
    }
}

function hasNonEmptyMessage(summary) {
    return !!(summary && typeof summary.message === 'string' && summary.message.trim().length > 0);
}

async function fetchDailySummary(date) {
    try {
        const res = await fetch(`/api/daily/${encodeURIComponent(date)}`);
        if (!res.ok) return null;
        return await res.json();
    } catch (_e) {
        return null;
    }
}

function shouldTriggerAdvice(date, summary) {
    if (!isValidRunDate(date)) return false;
    if (!summary) return false;
    return !hasNonEmptyMessage(summary);
}

function renderSavedAdvice(summary) {
    const container = document.getElementById('daily-message-container');
    const textSpan = document.getElementById('daily-message-text');
    if (!container || !textSpan) return;
    if (hasNonEmptyMessage(summary)) {
        textSpan.textContent = String(summary.message).trim();
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
        textSpan.textContent = '';
    }
}

async function loadData(options = {}) {
    const triggerAdvice = !!(options && options.triggerAdvice);
    const syncSummary = !!(options && options.syncSummary);
    const dateInput = document.getElementById('dateInput');
    const date = dateInput.value;
    const summaryContainer = document.getElementById('summary');
    const tbody = document.querySelector('#resultTable tbody');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const syncJsonBtn = document.getElementById('syncJsonBtn');

    if (analyzeBtn) analyzeBtn.disabled = true;
    if (syncJsonBtn) syncJsonBtn.disabled = true;
    if (syncSummary) {
        if (syncJsonBtn) syncJsonBtn.textContent = 'SYNCING...';
    } else {
        if (analyzeBtn) analyzeBtn.textContent = 'ANALYZING...';
    }
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">Loading data...</td></tr>';

    // Clear advice message first
    const msgContainer = document.getElementById('daily-message-container');
    const msgText = document.getElementById('daily-message-text');
    if (msgContainer) msgContainer.style.display = 'none';
    if (msgText) msgText.textContent = '';

    try {
        const qs = new URLSearchParams({ date: String(date || '').trim() });
        if (syncSummary) qs.set('sync', '1');
        const res = await fetch(`/api/stride?${qs.toString()}`);
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Failed to fetch data');
        }

        const data = await res.json();
        tbody.innerHTML = '';

        let max = { stride: 0, time: '--:--' };

        if (data.length === 0) {
            // Guard Clause: Handle No Data (Rest Day)
            if (strideChartInstance) {
                strideChartInstance.destroy(); // Safety: Destroy existing chart
            }
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">No Running Data (Rest Day)</td></tr>';
            summaryContainer.innerHTML = ''; // Clear summary

            // Reset chart area to be blank/clean
            const ctx = document.getElementById('strideChart').getContext('2d');
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

            // Reset Daily Message (Rest Day)
            const restMessageContainer = document.getElementById('daily-message-container');
            const restMessageText = document.getElementById('daily-message-text');
            if (restMessageContainer && restMessageText) {
                restMessageContainer.style.display = 'block';
                const today = new Date();
                const yyyy = today.getFullYear();
                const mm = String(today.getMonth() + 1).padStart(2, '0');
                const dd = String(today.getDate()).padStart(2, '0');
                const todayStr = `${yyyy}-${mm}-${dd}`;
                restMessageText.textContent = (date === todayStr)
                    ? 'Google Fit sync may be delayed. Try again in a few minutes.'
                    : 'Rest & Recovery is important. No analysis for today.';
            }
            // Keep image picker available so today's first import can create data.
            checkAndRenderImages(date);
            return;
        }

        // Peak Performance Calculation (Using Backend-Smoothed Data)
        let maxStrideVal = 0;
        let maxIndex = 0;

        data.forEach((d, i) => {
            // Filter: Ignore if unrealistic Stride > 300cm (Safety)
            // Note: Heart rate filtering is already applied by the backend's "Hybrid Filter"
            // but we keep high-intensity focus for the highlight.
            const val = d.stride;
            const currentHR = d.heartRate;
            const hasGoodHeartRate = (currentHR !== undefined && currentHR !== null && currentHR > 100);

            if (val > maxStrideVal && hasGoodHeartRate) {
                maxStrideVal = val;
                maxIndex = i;
            }
        });

        const maxStride = maxStrideVal;
        const maxTime = data[maxIndex].time;
        let hrAtMax = 0;
        if (maxIndex < data.length - 2) {
            hrAtMax = Math.round((data[maxIndex].heartRate + data[maxIndex + 1].heartRate + data[maxIndex + 2].heartRate) / 3);
        } else {
            hrAtMax = data[maxIndex].heartRate;
        }

        let maxHeartRate = hrAtMax;

        data.forEach(d => {
            const velocityKmH = (d.distance / 1000) * 60; // distance in m, time in 1 min
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${d.time}</td>
                <td>${d.steps}</td>
                <td>${d.distance.toFixed(1)}</td>
                <td class="${d.stride > 140 ? 'cell-high' : ''}">${d.stride.toFixed(1)} cm</td>
                <td style="color: #00f2ff; font-weight: bold;">${velocityKmH.toFixed(1)}</td>
                <td style="color: #ff4444;">${d.heartRate ? Math.round(d.heartRate) : '-'}</td>
            `;
            tbody.appendChild(tr);
        });

        // Calculate Stats
        let maxHR = 0;
        let sumHR = 0;
        let countHR = 0;
        data.forEach(d => {
            if (d.heartRate > 0) {
                if (d.heartRate > maxHR) maxHR = d.heartRate;
                sumHR += d.heartRate;
                countHR++;
            }
        });
        const avgHR = countHR > 0 ? (sumHR / countHR) : 0;

        const totalGap = WR_STRIDE - maxStride;
        summaryContainer.innerHTML = renderSummary(maxStride, maxTime, totalGap, maxHR, avgHR);

        // --- Render Chart ---
        renderChart(data);

        // --- Check & Render Images ---
        checkAndRenderImages(date);

        const dailySummary = await fetchDailySummary(date);
        const canTriggerAdvice = triggerAdvice && shouldTriggerAdvice(date, dailySummary);

        // --- Call AI Advice (only when daily_summary exists and message is empty) ---
        if (canTriggerAdvice) {
            if (isGeminiEnabled()) {
                getGeminiAdvice(date, maxStride, data);
            } else if (isOpenAiEnabled()) {
                getOpenAiAdvice(date, maxStride, data);
            } else {
                renderSavedAdvice(dailySummary);
            }
        } else {
            renderSavedAdvice(dailySummary);
        }

    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #f43f5e;">Error loading data: ${error.message}</td></tr>`;
        // Even if stride fetch fails, still allow importing images for the selected date.
        checkAndRenderImages(date);
    } finally {
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'RUN ANALYZER';
        }
        if (syncJsonBtn) {
            syncJsonBtn.disabled = false;
            syncJsonBtn.textContent = 'SYNC FIT JSON';
        }
    }
}

async function buildAdvicePayload(date, maxStride, data) {
    const runningData = data.filter(d => d.steps > 140);
    const totalRunningSteps = runningData.reduce((acc, d) => acc + d.steps, 0);
    const avgStride = totalRunningSteps > 0 ? (runningData.reduce((acc, d) => acc + (d.stride * d.steps), 0) / totalRunningSteps) : 0;
    const totalSteps = data.reduce((acc, d) => acc + (Number(d.steps) || 0), 0);
    const totalDistanceKm = data.reduce((acc, d) => acc + (Number(d.distance) || 0), 0) / 1000;
    const totalSeconds = Math.max(0, data.length * 60);
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    const totalTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;

    let sumCadence = 0;
    let countCadence = 0;
    let maxCadence = 0;
    let sumSpeed = 0;
    let countSpeed = 0;
    let maxSpeed = 0;
    data.forEach(d => {
        if (d.steps > maxCadence) maxCadence = d.steps;
        if (d.steps > 140) {
            sumCadence += d.steps;
            countCadence += 1;
        }
        if (d.speed > 0) {
            sumSpeed += d.speed;
            countSpeed += 1;
        }
        if (d.speed > maxSpeed) maxSpeed = d.speed;
    });
    const avgCadence = countCadence > 0 ? (sumCadence / countCadence) : 0;
    const avgSpeed = countSpeed > 0 ? (sumSpeed / countSpeed) : 0;

    // HR
    let maxHR = 0;
    let sumHR = 0;
    let countHR = 0;
    data.forEach(d => {
        if (d.heartRate > 0) {
            sumHR += d.heartRate;
            countHR += 1;
        }
        if (d.heartRate > maxHR) maxHR = d.heartRate;
    });
    const avgHR = countHR > 0 ? (sumHR / countHR) : 0;

    let summary = null;
    try {
        const dailyRes = await fetch(`/api/daily/${encodeURIComponent(date)}`);
        if (dailyRes.ok) summary = await dailyRes.json();
    } catch {
        // ignore and use computed fallback
    }

    return {
        date,
        stepCount: Number(summary?.step_count) > 0 ? Number(summary.step_count) : Math.round(totalSteps || 0),
        totalDistanceKm: Number(summary?.total_distance_km) > 0 ? Number(summary.total_distance_km) : Number((totalDistanceKm || 0).toFixed(2)),
        totalTime: (summary?.total_time && String(summary.total_time).trim()) ? String(summary.total_time).trim() : totalTime,
        avgStride: Number(summary?.avg_stride) > 0 ? Number(summary.avg_stride) : Number(avgStride.toFixed(1)),
        maxStride: Number(summary?.max_stride) > 0 ? Number(summary.max_stride) : Number(maxStride.toFixed(1)),
        avgHR: Number(summary?.hr_avg) > 0 ? Number(summary.hr_avg) : Math.round(avgHR || 0),
        maxHR: Number(summary?.hr_max) > 0 ? Number(summary.hr_max) : Math.round(maxHR || 0),
        avgCadence: Number(summary?.avg_cadence) > 0 ? Number(summary.avg_cadence) : Math.round(avgCadence || 0),
        maxCadence: Number(summary?.max_cadence) > 0 ? Number(summary.max_cadence) : Math.round(maxCadence || 0),
        avgSpeed: Number(summary?.avg_speed) > 0 ? Number(summary.avg_speed) : Number((avgSpeed || 0).toFixed(1)),
        maxSpeed: Number(summary?.max_speed) > 0 ? Number(summary.max_speed) : Number((maxSpeed || 0).toFixed(1))
    };
}

async function getOpenAiAdvice(date, maxStride, data) {
    const container = document.getElementById('daily-message-container');
    const textSpan = document.getElementById('daily-message-text');
    if (!container || !textSpan) return;

    container.style.display = 'block';
    textSpan.innerHTML = '<span style="animation: pulse-glow 1.5s infinite;">OpenAI is analyzing...</span>';

    try {
        const payload = await buildAdvicePayload(date, maxStride, data);
        const res = await fetch('/api/advice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `API ${res.status}`);
        textSpan.textContent = String(json.advice || '').trim() || 'No advice returned.';
    } catch (e) {
        textSpan.textContent = `OpenAI Advice Failed: ${e.message}`;
    }
}

async function getGeminiAdvice(date, maxStride, data) {
    const container = document.getElementById('daily-message-container');
    const textSpan = document.getElementById('daily-message-text');
    if (!container || !textSpan) return;

    container.style.display = 'block';
    textSpan.innerHTML = '<span style="animation: pulse-glow 1.5s infinite;">Gemini is analyzing...</span>';

    try {
        const payload = await buildAdvicePayload(date, maxStride, data);
        const res = await fetch('/api/advice/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `API ${res.status}`);
        textSpan.textContent = String(json.advice || '').trim() || 'No advice returned.';
    } catch (e) {
        textSpan.textContent = `Gemini Advice Failed: ${e.message}`;
    }
}

function renderSummary(maxStride, maxTime, totalGap, maxHR, avgHR) {
    const gapSign = totalGap > 0 ? '-' : '+';
    const absGap = Math.abs(totalGap).toFixed(1);

    return `
        <div class="glass-card summary-grid">
            <div class="stat-item">
                <span class="stat-label">Peak Performance</span>
                <span class="stat-value highlight">${maxStride.toFixed(1)} cm</span>
                <span class="stat-label" style="font-size: 0.75rem; margin-top: 4px;">At ${maxTime}</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">VS World Record</span>
                <span class="stat-value negative">${gapSign}${absGap} cm</span>
                <span class="stat-label" style="font-size: 0.75rem; margin-top: 4px;">Target: ${WR_STRIDE} cm</span>
            </div>
            <div class="stat-item" style="border-left: 1px solid rgba(255,255,255,0.1);">
                <span class="stat-label">Max Heart Rate</span>
                <span class="stat-value" style="color: #ff4444;">${maxHR ? Math.round(maxHR) : '-'} bpm</span>
            </div>
            <div class="stat-item">
                <span class="stat-label">Avg Heart Rate</span>
                <span class="stat-value" style="color: #ff9999;">${avgHR ? Math.round(avgHR) : '-'} bpm</span>
            </div>
        </div>
    `;
}

// Chart Global Variable
let strideChartInstance = null;

// Helper: Calculate Simple Moving Average
function calculateSMA(data, windowSize) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < windowSize - 1) {
            // Not enough data for full window, use average of available or just raw (using raw for start)
            sma.push(data[i]);
        } else {
            let sum = 0;
            for (let j = 0; j < windowSize; j++) {
                sum += data[i - j];
            }
            sma.push(sum / windowSize);
        }
    }
    return sma;
}

function renderChart(data) {
    const ctx = document.getElementById('strideChart').getContext('2d');

    // Destroy existing chart to prevent overlap
    if (strideChartInstance) {
        strideChartInstance.destroy();
    }

    const times = data.map(d => d.time);
    const strides = data.map(d => d.stride);
    // Since backend already sends 5-pt SMA data, we don't need another SMA filter here
    const smaStrides = strides;

    // Heart Rate: Use directly (Backend also smooths this to 5-pt SMA)
    const heartRatesRaw = data.map(d => d.heartRate || 0);
    const heartRatesSMA = heartRatesRaw.map(v => v > 0 ? v : null);

    strideChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: times,
            datasets: [
                // --- STRIDE ---
                {
                    label: 'Stride (5-pt SMA)',
                    data: smaStrides,
                    borderColor: '#00f2ff', // Cyan (Main)
                    backgroundColor: 'rgba(0, 242, 255, 0.05)',
                    borderWidth: 3,
                    pointRadius: 2, // Slight radius for visibility
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y-stride',
                    order: 1
                },
                // --- HEART RATE ---
                {
                    label: 'HR (5-pt SMA)',
                    data: heartRatesSMA,
                    borderColor: '#ff0055', // Bold Red
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointRadius: 0,
                    tension: 0.4,
                    fill: false,
                    yAxisID: 'y-heartrate',
                    order: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                x: {
                    grid: { color: '#444' },
                    ticks: { color: '#eee' }
                },
                'y-stride': {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Stride (cm)',
                        color: '#00f2ff'
                    },
                    grid: { color: '#444' },
                    ticks: { color: '#00f2ff' },
                    beginAtZero: false
                },
                'y-heartrate': {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Heart Rate (bpm)',
                        color: '#ff0055'
                    },
                    grid: {
                        drawOnChartArea: false // Hide grid for this axis 
                    },
                    ticks: { color: '#ff0055' },
                    beginAtZero: false
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#eee' }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    restoreHeightInput();
    restoreRunDateInput();
    restoreSnapshotDateInput();
    restoreFitSyncFromDateInput();
    restoreAdviceToggles();
    bindAdviceToggles();

    loadData({ triggerAdvice: false });
    updateDebugHints();

    document.getElementById('analyzeBtn').addEventListener('click', () => {
        loadData({ triggerAdvice: true });
    });
    document.getElementById('syncJsonBtn')?.addEventListener('click', syncFitJsonRangeFromUi);
    document.getElementById('runBatchBtn')?.addEventListener('click', runBatchFromScreen);
    document.getElementById('batchLoadImagesBtn')?.addEventListener('click', handleBatchLoadImages);
    document.getElementById('imageImportBtn')?.addEventListener('click', runImageImportFlow);
    document.getElementById('dateInput')?.addEventListener('change', () => {
        persistRunDateInput();
        batchSelectedFiles.clear();
        setBatchPickerMessage('Date changed. Press SYNC DAILY to process.');
        renderBatchIdleState('Date updated. Press SYNC DAILY to process.');
    });
    document.getElementById('snapshotDateInput')?.addEventListener('change', () => {
        const snapshotInput = document.getElementById('snapshotDateInput');
        const snapshotDate = snapshotInput ? normalizeRunDate(snapshotInput.value) : '';
        persistSnapshotDateInput();
        if (snapshotDate) {
            markDebugAnchorDate(snapshotDate);
        } else {
            updateDebugHints();
        }
        renderBatchIdleState('Snapshot date updated. Press SYNC DAILY to run.');
    });
    document.getElementById('fitSyncFromDateInput')?.addEventListener('change', () => {
        const fromInput = document.getElementById('fitSyncFromDateInput');
        const fromDate = fromInput ? normalizeRunDate(fromInput.value) : '';
        persistFitSyncFromDateInput();
        if (fromDate) {
            markDebugAnchorDate(fromDate);
        } else {
            updateDebugHints();
        }
    });
    document.getElementById('saveHeightBtn')?.addEventListener('click', saveHeightInput);
    // Modal Event Listeners
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('inboxModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('inboxModal')) closeModal();
    });
    document.getElementById('importBtn').addEventListener('click', importSelectedImages);

    // Initial History Load
    loadRunHistory();
    setBatchPickerMessage('No images loaded yet. Press SYNC DAILY after confirming dates.');
    renderBatchIdleState('Ready. Press SYNC DAILY to import/sync.');
});

async function loadRunHistory() {
    const tbody = document.querySelector('#historyTable tbody');
    if (!tbody) {
        console.error("History Table Body not found!");
        return;
    }

    try {
        const res = await fetch('/api/runs');
        if (!res.ok) throw new Error('API Failed');
        const runs = await res.json();

        tbody.innerHTML = '';

        // Sort descending by date
        runs.sort((a, b) => new Date(b.date) - new Date(a.date));

        runs.forEach(run => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.onclick = () => {
                document.getElementById('dateInput').value = run.date;
                loadData({ triggerAdvice: false }); // Load chart only

                // Highlight selected row with class
                document.querySelectorAll('#historyTable tr').forEach(r => r.classList.remove('history-row-active'));
                tr.classList.add('history-row-active');
            };

            tr.innerHTML = `
                <td>${run.date}</td>
                <td class="${run.max_stride > 140 ? 'cell-high' : ''}">${run.max_stride ? run.max_stride.toFixed(1) : '-'} cm</td>
                <td style="color: #ff4444;">${run.max_heart_rate ? Math.round(run.max_heart_rate) : '-'}</td>
                <td><button class="btn-primary" style="padding: 4px 10px; font-size: 0.7rem; min-width: auto;" onclick="event.stopPropagation(); deleteRun('${run.id ?? ''}', '${run.date}')">DEL</button></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Failed to load history:', err);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Failed to load history</td></tr>';
    }
}

async function deleteRun(runId, runDate) {
    if (!confirm('Are you sure you want to delete this run?')) return;
    try {
        const rawId = (runId ?? '').toString().trim();
        const fallbackDate = (runDate ?? '').toString().trim();
        const target = rawId || fallbackDate;
        if (!target) {
            alert('Delete failed: invalid run id');
            return;
        }

        const res = await fetch(`/api/runs/${encodeURIComponent(target)}`, { method: 'DELETE' });
        if (res.ok) {
            loadRunHistory(); // Refresh list
        } else {
            alert('Delete failed');
        }
    } catch (err) {
        alert('Error deleting run');
    }
}

// --- Image Management Logic ---

function ensurePickerButton(date) {
    const summarySection = document.getElementById('summary');
    if (!summarySection) return;

    const existingBtn = document.getElementById('openPickerBtn');
    if (existingBtn) existingBtn.remove();

    const btn = document.createElement('div');
    btn.id = 'openPickerBtn';
    btn.textContent = '+ Select Image from Phone Link';
    btn.onclick = () => openInboxModal(date);
    summarySection.appendChild(btn);
}

async function checkAndRenderImages(date) {
    const summarySection = document.getElementById('summary');
    if (!summarySection) return;

    // Remove existing image container if any
    const existingContainer = document.querySelector('.run-images-container');
    if (existingContainer) existingContainer.remove();
    const existingBtn = document.getElementById('openPickerBtn');
    if (existingBtn) existingBtn.remove();

    try {
        const res = await fetch(`/api/runs/${date}/images`);
        if (!res.ok) throw new Error(`Failed to fetch images: ${res.status}`);
        const images = await res.json();

        // 1. Render Images Container (if images exist)
        if (images && images.length > 0) {
            const imageContainer = document.createElement('div');
            imageContainer.className = 'run-images-container';

            images.forEach(img => {
                const card = document.createElement('div');
                card.className = 'run-image-card';
                // Using the store path (assuming public/assets/store is served)
                const imgUrl = `/assets/store/${img.stored_filename}`;

                // Check if analysis exists
                const hasAnalysis = img.total_time && img.total_distance;

                let overlayHTML = '';
                if (hasAnalysis) {
                    // Format Distance (e.g. 15.41) - Assume DB stores as number
                    const distDisplay = parseFloat(img.total_distance).toFixed(2) + ' km';

                    overlayHTML = `
                        <div class="results-overlay">
                            <div class="analysis-tag time">
                                <span class="icon">TIME</span>
                                <span>${img.total_time}</span>
                            </div>
                            <div class="analysis-tag distance">
                                <span class="icon">DIST</span>
                                <span>${distDisplay}</span>
                            </div>
                        </div>
                    `;
                }

                card.innerHTML = `
                    <img src="${imgUrl}" alt="Run Image" loading="lazy" decoding="async">
                    ${overlayHTML}
                `;

                // Lightbox Trigger (on image click)
                card.querySelector('img').onclick = (e) => {
                    e.stopPropagation();
                    // Pass analysis state to lightbox
                    openLightbox(imgUrl, date, img.asset_id, hasAnalysis);
                };

                // Also allow clicking the overlay to open lightbox
                if (hasAnalysis) {
                    card.querySelector('.results-overlay').onclick = (e) => {
                        e.stopPropagation();
                        openLightbox(imgUrl, date, img.asset_id, hasAnalysis);
                    };
                }

                imageContainer.appendChild(card);
            });
            summarySection.appendChild(imageContainer);
        }

    } catch (err) {
        console.error('Error fetching images:', err);
    } finally {
        // Always show picker even if image API failed.
        ensurePickerButton(date);
    }
}

// Modal State
let currentRunDate = null;
let selectedFiles = new Set();

async function openInboxModal(date) {
    currentRunDate = date;
    const modal = document.getElementById('inboxModal');
    const grid = document.getElementById('inboxGrid');
    const importBtn = document.getElementById('importBtn');

    modal.style.display = 'flex';
    grid.innerHTML = '<div style="color:#888; text-align:center; width:100%;">Loading Phone Link...</div>';
    selectedFiles.clear();
    importBtn.disabled = true;
    importBtn.textContent = 'Import Selected';

    try {
        const res = await fetch('/api/inbox/files');
        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const files = await res.json();

        grid.innerHTML = '';

        if (!Array.isArray(files)) {
            console.error('Expected array but got:', files);
            grid.innerHTML = '<div style="color:red; text-align:center;">Error: Invalid response format</div>';
            return;
        }

        if (files.length === 0) {
            grid.innerHTML = '<div style="color:#888; text-align:center; width:100%;">Phone Link folder is empty</div>';
            return;
        }

        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'inbox-item';
            // Added onError to handle broken images
            item.innerHTML = `
                <img src="/api/inbox/preview/${encodeURIComponent(file)}" alt="${file}" loading="lazy" decoding="async">
                <div class="image-filename">${file}</div>
            `;
            item.onclick = () => toggleSelection(item, file);
            grid.appendChild(item);
        });

    } catch (err) {
        console.error(err);
        grid.innerHTML = '<div style="color:red; text-align:center;">Failed to load inbox</div>';
    }
}

function closeModal() {
    document.getElementById('inboxModal').style.display = 'none';
    currentRunDate = null;
    selectedFiles.clear();
}

function toggleSelection(element, filename) {
    if (selectedFiles.has(filename)) {
        selectedFiles.delete(filename);
        element.classList.remove('selected');
    } else {
        selectedFiles.add(filename);
        element.classList.add('selected');
    }

    const btn = document.getElementById('importBtn');
    btn.disabled = selectedFiles.size === 0;
    btn.textContent = selectedFiles.size > 0 ? `Import ${selectedFiles.size} Image(s)` : 'Import Selected';
}

async function importSelectedImages() {
    if (!currentRunDate || selectedFiles.size === 0) return;

    const btn = document.getElementById('importBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Importing...';
    btn.disabled = true;

    try {
        const res = await fetch(`/api/runs/${currentRunDate}/import-selected`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filenames: Array.from(selectedFiles)
            })
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            const rows = Array.isArray(payload?.results) ? payload.results : [];
            const failedRows = rows.filter(r => r && r.status !== 'success');
            if (failedRows.length > 0) {
                const first = failedRows[0];
                const file = first && first.file ? String(first.file) : '(unknown)';
                const reason = first && first.error ? String(first.error) : 'Import failed';
                alert(`Import failed: ${file}\n${reason}`);
            } else {
                alert(payload?.error ? String(payload.error) : 'Import failed');
            }
            throw new Error(payload?.error ? String(payload.error) : 'Import failed');
        }

        const dateToRefresh = currentRunDate; // Capture before clearing
        closeModal();
        // Refresh images area
        checkAndRenderImages(dateToRefresh);

    } catch (err) {
        console.error(err);
        btn.textContent = 'Error!';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

async function unlinkImage(runId, assetId) {
    try {
        const res = await fetch(`/api/runs/${runId}/images/${assetId}`, {
            method: 'DELETE'
        });

        if (!res.ok) throw new Error('Unlink failed');

        // Refresh
        checkAndRenderImages(runId);

    } catch (err) {
        console.error(err);
        alert('Failed to unlink image');
    }
}

// Lightbox Logic
let lbCurrentRunId = null;
let lbCurrentAssetId = null;
let lbCurrentSrc = null;

function openLightbox(src, runId, assetId, hasAnalysis = false) {
    const lightbox = document.getElementById('lightbox');
    const img = document.getElementById('lightboxImg');
    const unlinkBtn = document.getElementById('lbUnlinkBtn');

    if (lightbox && img) {
        img.src = src;
        lightbox.style.display = 'flex';
        if (unlinkBtn) unlinkBtn.style.display = 'none';

        // LOCK SCROLL
        document.body.style.overflow = 'hidden';

        // Store context for delete action
        lbCurrentRunId = runId;
        lbCurrentAssetId = assetId;
        lbCurrentSrc = src;
    }
}

// Lightbox Close Logic
function closeLightbox() {
    const lb = document.getElementById('lightbox');
    if (lb) {
        lb.style.display = 'none';
        lbCurrentRunId = null;
        lbCurrentAssetId = null;

        // UNLOCK SCROLL
        document.body.style.overflow = '';
    }
}

// Event Listeners for Lightbox Controls
document.getElementById('lbCloseBtn')?.addEventListener('click', closeLightbox);
document.getElementById('lightbox')?.addEventListener('click', (e) => {
    // Close if clicking overlay (outside image)
    if (e.target === document.getElementById('lightbox')) {
        closeLightbox();
    }
});

document.getElementById('lbUnlinkBtn')?.addEventListener('click', () => {
    alert('Image delete is disabled.');
});

async function loadDailyMessage(date) {
    const container = document.getElementById('daily-message-container');
    const textSpan = document.getElementById('daily-message-text');

    try {
        const res = await fetch(`/api/daily/${date}`);
        if (!res.ok) {
            // 404 is expected if no message exists yet
            container.style.display = 'none';
            return;
        }

        const data = await res.json();
        if (data.message && data.message.trim().length > 0) {
            textSpan.textContent = data.message;
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }

    } catch (err) {
        console.error('Error fetching daily message:', err);
        container.style.display = 'none';
    }
}




function getBatchFilenames() {
    const input = document.getElementById('batchFilenamesInput');
    const fromInput = input ? String(input.value || '')
        .split(/\r?\n/)
        .map(v => v.trim())
        .filter(Boolean) : [];

    return Array.from(new Set([...batchSelectedFiles, ...fromInput]));
}

function renderBatchResult(payload) {
    const el = document.getElementById('batchResult');
    if (!el) return;
    el.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
}

function renderBatchIdleState(message) {
    const dateInput = document.getElementById('dateInput');
    const runDate = dateInput ? String(dateInput.value || '').trim() : '';
    renderBatchResult({
        mode: 'idle',
        run_date: runDate || null,
        total: 0,
        message
    });
}

async function runBatchFromScreen(options = {}) {
    const runBtn = document.getElementById('runBatchBtn');
    const imageImportBtn = document.getElementById('imageImportBtn');
    const dateInput = document.getElementById('dateInput');
    const snapshotInput = document.getElementById('snapshotDateInput');
    const selectedMode = document.querySelector('input[name="batchOcrMode"]:checked');

    if (!dateInput) return { ok: false, skipped: true, reason: 'missing-date-input' };

    const snapshotDate = normalizeRunDate(options.snapshotDate || (snapshotInput ? snapshotInput.value : ''));
    const dateFromRun = normalizeRunDate(options.runDate || dateInput.value);
    const runDate = snapshotDate || dateFromRun;
    if (!runDate) {
        renderBatchResult('Date is required.');
        return { ok: false, skipped: true, reason: 'missing-run-date' };
    }

    const filenames = getBatchFilenames();
    if (filenames.length === 0) {
        renderBatchResult({
            mode: 'batch-skip',
            run_date: runDate,
            total: 0,
            message: 'No images for this date. Skipped (this is normal when there is no linked image).'
        });
        return { ok: true, skipped: true, runDate, total: 0 };
    }

    const payload = {
        job: {
            job_id: '',
            source: 'screen-ui',
            ocr_mode_default: 'python'
        },
        items: filenames.map((filename, idx) => ({
            item_id: `item-${idx + 1}`,
            filename,
            mode: selectedMode ? String(selectedMode.value || 'python') : 'python',
            date: runDate,
            runId: runDate
        }))
    };

    const targetBtn = runBtn || imageImportBtn;
    const originalText = targetBtn ? targetBtn.textContent : '';
    const runToken = ++latestBatchRunToken;
    const expectedJobId = `ui-${Date.now()}-${runToken}`;
    payload.job.job_id = expectedJobId;
    if (targetBtn) {
        targetBtn.disabled = true;
        targetBtn.textContent = 'RUNNING...';
    }
    renderBatchResult('Running batch...');

    try {
        const res = await fetch('/api/analyze/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Batch failed: ${res.status}`);
        if (runToken !== latestBatchRunToken) {
            return { ok: false, skipped: true, reason: 'stale-token' };
        }
        if (data && data.job && data.job.job_id && data.job.job_id !== expectedJobId) {
            return { ok: false, skipped: true, reason: 'job-id-mismatch' };
        }

        renderBatchResult({
            mode: data.mode,
            run_date: runDate,
            job_id: data && data.job ? data.job.job_id : expectedJobId,
            total: data.total,
            success: data.success,
            failed: data.failed,
            persisted: data.persisted,
            preview: Array.isArray(data.results) ? data.results.slice(0, 3) : []
        });

        Promise.allSettled([loadRunHistory(), loadData(), loadBatchImageCandidates()])
            .catch(() => { /* ignore refresh errors */ });
        return {
            ok: true,
            skipped: false,
            runDate,
            total: Number(data && data.total ? data.total : 0),
            success: Number(data && data.success ? data.success : 0),
            failed: Number(data && data.failed ? data.failed : 0)
        };
    } catch (err) {
        if (runToken !== latestBatchRunToken) return;
        renderBatchResult(`Batch Error: ${err.message}`);
        return { ok: false, skipped: false, runDate, error: err.message };
    } finally {
        if (runToken === latestBatchRunToken && targetBtn) {
            targetBtn.disabled = false;
            targetBtn.textContent = originalText;
        }
    }
}

async function syncDailySummaryFromCache(date) {
    const runDate = normalizeRunDate(date);
    if (!runDate) return { ok: false, skipped: true, reason: 'invalid-date' };

    const res = await fetch(`/api/daily/${encodeURIComponent(runDate)}/sync-cache`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = payload && payload.error ? String(payload.error) : `HTTP ${res.status}`;
        throw new Error(`daily_summary sync failed (${runDate}): ${msg}`);
    }
    return payload || { success: true, skipped: true, reason: 'empty-payload' };
}

async function runImageImportFlow() {
    const btn = document.getElementById('imageImportBtn');
    const dateInput = document.getElementById('dateInput');
    const snapshotInput = document.getElementById('snapshotDateInput');
    const manualFrom = snapshotInput ? normalizeRunDate(snapshotInput.value) : '';
    if (manualFrom) {
        markDebugAnchorDate(manualFrom);
    }
    const dates = getPendingDateRangeWithFrom(IMAGE_IMPORT_CHECKPOINT_DATE_STORAGE_KEY, manualFrom);
    if (dates.length === 0) {
        alert('No pending daily-sync dates.');
        updateDebugHints();
        return;
    }

    const dateBackup = dateInput ? String(dateInput.value || '') : '';
    const snapshotBackup = snapshotInput ? String(snapshotInput.value || '') : '';
    let okCount = 0;
    let failCount = 0;
    let lastSuccess = '';
    let firstFailure = '';
    const originalText = btn ? btn.textContent : '';

    if (btn) {
        btn.disabled = true;
        btn.textContent = `SYNCING 0/${dates.length}`;
    }
    try {
        for (let i = 0; i < dates.length; i++) {
            const d = dates[i];
            if (dateInput) dateInput.value = d;
            if (snapshotInput) snapshotInput.value = d;
            persistRunDateInput();
            persistSnapshotDateInput();

            const importedResult = await handleBatchLoadImages();
            if (importedResult && importedResult.error) {
                failCount += 1;
                firstFailure = d;
                break;
            }

            const batchResult = await runBatchFromScreen({ runDate: d, snapshotDate: d });
            if (!batchResult || batchResult.ok === false) {
                failCount += 1;
                firstFailure = d;
                break;
            }

            // If there are no linked images for this date, try cache-based sync.
            // Server-side guard will skip creation when run signal is too weak.
            if (batchResult.skipped === true || Number(batchResult.total || 0) === 0) {
                try {
                    await syncDailySummaryFromCache(d);
                } catch (_syncErr) {
                    failCount += 1;
                    firstFailure = d;
                    break;
                }
            }

            okCount += 1;
            lastSuccess = d;
            if (btn) btn.textContent = `SYNCING ${i + 1}/${dates.length}`;
        }
    } finally {
        if (dateInput) dateInput.value = dateBackup;
        if (snapshotInput) snapshotInput.value = snapshotBackup;
        persistRunDateInput();
        persistSnapshotDateInput();

        if (lastSuccess) {
            localStorage.setItem(IMAGE_IMPORT_CHECKPOINT_DATE_STORAGE_KEY, lastSuccess);
        }
        updateDebugHints();

        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText || 'SYNC DAILY';
        }
    }

    if (firstFailure) {
        alert(`Image import stopped at ${firstFailure}. success ${okCount}, failed ${failCount}`);
    } else {
        alert(`Image import completed: success ${okCount}, failed ${failCount}`);
    }
}

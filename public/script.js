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

function extractRunDateFromFilename(filename) {
    const raw = String(filename || '').trim();
    if (!raw) return '';
    const normalized = raw.replace(/\s+/g, '');

    let match = normalized.match(/(\d{4})[-_]?(\d{2})[-_]?(\d{2})/);
    if (match) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }

    match = normalized.match(/(\d{1,2})[-_](\d{1,2})[-_](\d{4})/);
    if (match) {
        return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
    }

    return '';
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

function restoreAgeInput() {
    const input = document.getElementById('ageInput');
    if (!input) return;
    const saved = String(localStorage.getItem('profile.age') || '').trim();
    if (/^\d{1,3}$/.test(saved)) {
        input.value = saved;
    }
}

function saveAgeInput() {
    const input = document.getElementById('ageInput');
    if (!input) return;
    const raw = String(input.value || '').trim();
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 1 || v > 120) {
        alert('Age must be between 1 and 120.');
        return;
    }
    const rounded = String(Math.round(v));
    input.value = rounded;
    localStorage.setItem('profile.age', rounded);
    renderHeartRateGuide();
    refreshSummaryHeartRateGuide();
}

function getEstimatedMaxHeartRate() {
    const input = document.getElementById('ageInput');
    const raw = input ? String(input.value || '').trim() : '';
    const age = Number(raw);
    if (!Number.isFinite(age) || age < 1 || age > 120) return 0;
    return Math.max(0, 220 - age);
}

function restoreRestingHrInput() {
    const input = document.getElementById('restingHrInput');
    if (!input) return;
    const saved = String(localStorage.getItem('profile.rest_hr') || '').trim();
    if (/^\d{2,3}$/.test(saved)) {
        input.value = saved;
    }
}

function saveRestingHrInput() {
    const input = document.getElementById('restingHrInput');
    if (!input) return;
    const raw = String(input.value || '').trim();
    const v = Number(raw);
    if (!Number.isFinite(v) || v < 30 || v > 120) {
        alert('Resting HR must be between 30 and 120.');
        return;
    }
    const rounded = String(Math.round(v));
    input.value = rounded;
    localStorage.setItem('profile.rest_hr', rounded);
    renderHeartRateGuide();
    refreshSummaryHeartRateGuide();
}

function getRestingHeartRate() {
    const input = document.getElementById('restingHrInput');
    const raw = input ? String(input.value || '').trim() : '';
    const hr = Number(raw);
    if (!Number.isFinite(hr) || hr < 30 || hr > 120) return 0;
    return hr;
}

function getHeartRateZoneGuide() {
    const maxHr = getEstimatedMaxHeartRate();
    const restHr = getRestingHeartRate();
    if (!(maxHr > 0)) return { maxHrText: 'Max HR: -', maxText: 'LTHR: -', avgText: 'LSD: -', avgSubText: 'Z2: -' };

    const lsdLower = Math.round(maxHr * 0.60);
    const lsdUpper = Math.round(maxHr * 0.70);

    if (!(restHr > 0) || restHr >= maxHr) {
        return {
            maxHrText: `Max HR: ${maxHr}`,
            maxText: 'LTHR: -',
            avgText: `LSD: ${lsdLower}-${lsdUpper}`,
            avgSubText: 'Z2: -'
        };
    }

    const lthr = Math.round((maxHr - restHr) * 0.85 + restHr);
    const z2Lower = Math.round((maxHr - restHr) * 0.60 + restHr);
    const z2Upper = Math.round((maxHr - restHr) * 0.70 + restHr);
    return {
        maxHrText: `Max HR: ${maxHr}`,
        maxText: `LTHR: ${lthr}`,
        avgText: `LSD: ${lsdLower}-${lsdUpper}`,
        avgSubText: `Z2: ${z2Lower}-${z2Upper} bpm`
    };
}

function renderHeartRateGuide() {
    const formula = document.getElementById('hrFormulaInfo');
    const target = document.getElementById('hrTargetInfo');
    const targetZ2 = document.getElementById('hrTargetInfoZ2');
    const maxHrEl = document.getElementById('computedMaxHr');
    const lthrEl = document.getElementById('computedLthr');
    const lsdEl = document.getElementById('computedLsd');
    const z2El = document.getElementById('computedZ2');
    if (!formula || !target) return;

    const guide = getHeartRateZoneGuide();

    formula.textContent = 'Max HR = 220 - age';
    target.textContent = 'LTHR = (HRmax - HRrest) x 0.85 + HRrest';
    if (targetZ2) targetZ2.textContent = 'Z2 = (HRmax - HRrest) x 0.60-0.70 + HRrest';
    if (maxHrEl) maxHrEl.textContent = guide.maxHrText;
    if (lthrEl) lthrEl.textContent = guide.maxText;
    if (lsdEl) lsdEl.textContent = guide.avgText;
    if (z2El) z2El.textContent = guide.avgSubText;
}

function refreshSummaryHeartRateGuide() {
    const summaryRoot = document.querySelector('#summary .summary-grid');
    if (!summaryRoot) return;

    const statItems = summaryRoot.querySelectorAll('.stat-item');
    if (!statItems || statItems.length < 4) return;

    const maxHeartRateItem = statItems[2];
    const avgHeartRateItem = statItems[3];
    const maxValue = maxHeartRateItem.querySelector('.stat-value');
    const avgValue = avgHeartRateItem.querySelector('.stat-value');
    if (!maxValue || !avgValue) return;

    const maxHrMatch = String(maxValue.textContent || '').match(/(\d+)/);
    const avgHrMatch = String(avgValue.textContent || '').match(/(\d+)/);
    const maxHr = maxHrMatch ? Number(maxHrMatch[1]) : 0;
    const avgHr = avgHrMatch ? Number(avgHrMatch[1]) : 0;
    const heartRateGuide = getHeartRateZoneGuide();
    const estimatedMaxHeartRate = getEstimatedMaxHeartRate();
    const heartRatePercent = estimatedMaxHeartRate > 0 && maxHr > 0
        ? ` (${Math.round((maxHr / estimatedMaxHeartRate) * 100)}%)`
        : '';

    maxValue.textContent = `${maxHr ? Math.round(maxHr) : '-'} bpm${heartRatePercent}`;
    avgValue.textContent = `${avgHr ? Math.round(avgHr) : '-'} bpm`;

    const maxGuideText = heartRateGuide.maxText;
    const avgGuideText = heartRateGuide.avgText;
    const avgGuideSubText = heartRateGuide.avgSubText;
    const avgGuideCombinedText = [avgGuideText, avgGuideSubText].filter(text => String(text || '').trim() && String(text || '').trim() !== 'Z2: -').join('   ');

    const maxGuide = maxHeartRateItem.querySelector('.heart-rate-guide-max');
    if (maxGuide) maxGuide.textContent = maxGuideText;

    const avgGuide = avgHeartRateItem.querySelector('.heart-rate-guide-avg');
    if (avgGuide) avgGuide.textContent = avgGuideCombinedText || avgGuideText;

    const avgGuideSub = avgHeartRateItem.querySelector('.heart-rate-guide-avg-sub');
    if (avgGuideSub) avgGuideSub.textContent = '';
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

function getSinglePendingState(checkpointKey, targetDate) {
    const normalizedTarget = normalizeRunDate(targetDate);
    const checkpoint = getStoredValidDate(checkpointKey);
    if (!normalizedTarget) {
        return { target: '', checkpoint: checkpoint || '-', pendingCount: 0 };
    }
    if (!checkpoint) {
        return { target: normalizedTarget, checkpoint: '-', pendingCount: 1 };
    }
    return {
        target: normalizedTarget,
        checkpoint,
        pendingCount: compareDateText(normalizedTarget, checkpoint) > 0 ? 1 : 0
    };
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
    const fitSyncFromInput = document.getElementById('fitSyncFromDateInput');
    const fitTarget = fitSyncFromInput ? normalizeRunDate(fitSyncFromInput.value) : '';
    const snapshotInput = document.getElementById('snapshotDateInput');
    const dateInput = document.getElementById('dateInput');
    const imageTarget = snapshotInput && normalizeRunDate(snapshotInput.value)
        ? normalizeRunDate(snapshotInput.value)
        : (dateInput ? normalizeRunDate(dateInput.value) : '');
    const fitState = getSinglePendingState(FIT_SYNC_CHECKPOINT_DATE_STORAGE_KEY, fitTarget);
    const imageState = getSinglePendingState(IMAGE_IMPORT_CHECKPOINT_DATE_STORAGE_KEY, imageTarget);

    const fitHint = document.getElementById('fitSyncHint');
    if (fitHint) {
        fitHint.textContent = `target ${fitState.target || '-'} / pending ${fitState.pendingCount}`;
    }
    const imageHint = document.getElementById('imageImportHint');
    if (imageHint) {
        imageHint.textContent = `target ${imageState.target || '-'} / pending ${imageState.pendingCount}`;
    }
}

async function syncFitJsonRangeFromUi() {
    const syncBtn = document.getElementById('syncJsonBtn');
    const fromInput = document.getElementById('fitSyncFromDateInput');
    const manualFrom = fromInput ? normalizeRunDate(fromInput.value) : '';
    const targetDate = manualFrom || getDebugAnchorDate();
    if (!targetDate) {
        alert('FIT sync date is required.');
        return;
    }
    markDebugAnchorDate(targetDate);
    const targetDates = [targetDate];
    const pendingState = getSinglePendingState(FIT_SYNC_CHECKPOINT_DATE_STORAGE_KEY, targetDate);
    if (pendingState.pendingCount === 0) {
        const shouldContinue = confirm(`${targetDate} is not pending. Run SYNC FIT JSON for this date again?`);
        if (!shouldContinue) {
            updateDebugHints();
            return;
        }
    }

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

function getSelectedClearMode() {
    const selected = document.querySelector('input[name="clearMode"]:checked');
    return selected ? String(selected.value || '').trim() : 'daily';
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
        setBatchPickerMessage('Importing from Mobile Devices...');
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

function isTemporaryUnavailableMessage(summary) {
    const text = summary && typeof summary.message === 'string' ? summary.message.trim() : '';
    return text === '現在利用が制限されています。しばらくお待ちください。';
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

async function fetchDailySessions(date) {
    try {
        const res = await fetch(`/api/sessions/${encodeURIComponent(date)}`);
        if (!res.ok) return [];
        const json = await res.json();
        return Array.isArray(json) ? json : [];
    } catch (_e) {
        return [];
    }
}

function formatSessionTimeRange(session) {
    const startMs = Number(session && session.startTimeMillis);
    const endMs = Number(session && session.endTimeMillis);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return '';
    const start = new Date(startMs);
    const end = new Date(endMs);
    const format = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${format(start)}-${format(end)}`;
}

function renderSessionSummary(sessions) {
    const rows = (Array.isArray(sessions) ? sessions : [])
        .filter((session) => Number(session && session.activityType) === 8)
        .sort((a, b) => Number(a && a.startTimeMillis) - Number(b && b.startTimeMillis));
    if (rows.length === 0) return '';

    const items = rows.map((session, index) => {
        const name = String(session && session.name ? session.name : `Run ${index + 1}`).trim();
        const timeRange = formatSessionTimeRange(session);
        return `
            <div style="display:flex; justify-content:space-between; gap:12px; padding:10px 12px; border:1px solid rgba(255,255,255,0.08); border-radius:10px; background:rgba(255,255,255,0.03);">
                <span style="color:#f3f4f6;">${name || `Run ${index + 1}`}</span>
                <span style="color:#7af0b8; font-variant-numeric: tabular-nums;">${timeRange || '-'}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="glass-card" style="display:grid; gap:12px; margin-bottom:18px;">
            <div style="display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <span class="stat-label" style="font-size:0.8rem;">Google Fit Sessions</span>
                <span class="stat-label" style="font-size:0.75rem;">${rows.length} run${rows.length === 1 ? '' : 's'}</span>
            </div>
            ${items}
        </div>
    `;
}

function shouldTriggerAdvice(date, summary) {
    if (!isValidRunDate(date)) return false;
    if (!summary) return false;
    return !hasNonEmptyMessage(summary) || isTemporaryUnavailableMessage(summary);
}

function hasRunningDataForAdvice(data) {
    if (!Array.isArray(data) || data.length === 0) return false;
    const runningPoints = data.filter((d) => Number(d?.steps) > 140);
    if (runningPoints.length < 3) return false;
    const totalRunningSteps = runningPoints.reduce((acc, d) => acc + (Number(d?.steps) || 0), 0);
    return totalRunningSteps >= 400;
}

async function renderSavedAdvice(summary) {
    const container = document.getElementById('daily-message-container');
    const textSpan = document.getElementById('daily-message-text');
    if (!container || !textSpan) return;
    const selectedRun = getSelectedActiveRun();
    if (selectedRun) {
        const runMessage = await loadRunMessage(currentTcxRunPageDate, selectedRun.runId);
        if (String(runMessage || '').trim()) {
            textSpan.textContent = String(runMessage).trim();
            container.style.display = 'block';
            return;
        }
        container.style.display = 'none';
        textSpan.textContent = '';
        return;
    }
    if (hasNonEmptyMessage(summary)) {
        textSpan.textContent = String(summary.message).trim();
        container.style.display = 'block';
        return;
    }
    container.style.display = 'none';
    textSpan.textContent = '';
}

let currentLapSplitExport = null;
let currentTcxMinuteExport = null;
let currentTcxRunPages = [];
let currentTcxRunPageIndex = 0;
let currentTcxRunPageDate = '';
let currentCorosFitRuns = [];
let currentCorosFitRunPageIndex = 0;
let currentCorosFitRunPageDate = '';
let currentHealthConnectRuns = [];
let currentHealthConnectRunPageIndex = 0;
let currentHealthConnectRunPageDate = '';
let currentRunChartSource = 'tcx';
let currentAdviceRunDate = '';
let currentAdviceData = [];
let currentAdviceUsesTcx = false;

function getSelectedTcxRun() {
    if (!Array.isArray(currentTcxRunPages) || currentTcxRunPages.length === 0) return null;
    const safeIndex = Math.min(Math.max(Number(currentTcxRunPageIndex) || 0, 0), currentTcxRunPages.length - 1);
    return currentTcxRunPages[safeIndex] || null;
}

function getSelectedCorosFitRun() {
    if (!Array.isArray(currentCorosFitRuns) || currentCorosFitRuns.length === 0) return null;
    const safeIndex = Math.min(Math.max(Number(currentCorosFitRunPageIndex) || 0, 0), currentCorosFitRuns.length - 1);
    const run = currentCorosFitRuns[safeIndex] || null;
    return run ? { ...run, runId: String(run.labelId || '') } : null;
}

function getSelectedActiveRun() {
    if (currentRunChartSource === 'coros_fit') return getSelectedCorosFitRun();
    if (currentRunChartSource === 'tcx') return getSelectedTcxRun();
    return null;
}

function getSelectedAdviceRunId() {
    const selectedRun = getSelectedActiveRun();
    const runId = String(selectedRun?.runId || '').trim();
    return runId || '';
}

async function loadRunMessage(date, runId) {
    const normalizedDate = normalizeRunDate(date);
    const normalizedRunId = String(runId || '').trim();
    if (!normalizedDate || !normalizedRunId) return '';
    try {
        const res = await fetch(`/api/daily/${encodeURIComponent(normalizedDate)}/run-message/${encodeURIComponent(normalizedRunId)}`);
        if (!res.ok) return '';
        const row = await res.json();
        return typeof row?.message === 'string' ? row.message.trim() : '';
    } catch (err) {
        console.error('Error fetching run message:', err);
        return '';
    }
}

function setLapExportState(payload) {
    currentLapSplitExport = payload || null;
}

function setTcxExportState(payload) {
    currentTcxMinuteExport = payload || null;
}

function placeDailyMessageContainerInsidePager(usePager) {
    const container = document.getElementById('daily-message-container');
    const host = document.getElementById('dailyMessageHost');
    const tcxSlot = document.getElementById('tcxDailyMessageSlot');
    if (!container || !host || !tcxSlot) return;
    if (usePager) {
        if (container.parentElement !== tcxSlot) {
            tcxSlot.appendChild(container);
            container.style.margin = '14px auto 0';
        }
        return;
    }
    if (container.parentElement !== host) {
        host.appendChild(container);
        container.style.margin = '20px auto';
    }
}

function buildTcxRunLabel(run, index, total) {
    const prefix = total > 1 ? `${index + 1}/${total}` : '1/1';
    const time = String(run?.startTimeLabel || '').trim();
    return time ? `TCX Run ${prefix} ${time}` : `TCX Run ${prefix}`;
}

function buildCorosFitRunLabel(run, index, total) {
    const prefix = total > 1 ? `${index + 1}/${total}` : '1/1';
    const startTime = String(run?.startTime || '').trim();
    const time = startTime ? new Date(startTime).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    return time ? `COROS FIT ${prefix} ${time}` : `COROS FIT ${prefix}`;
}

function updateTcxRunPager(runs = [], selectedIndex = 0) {
    const pager = document.getElementById('tcxRunPager');
    const label = document.getElementById('tcxRunPagerLabel');
    const prevBtn = document.getElementById('tcxRunPrevBtn');
    const nextBtn = document.getElementById('tcxRunNextBtn');
    const hasRuns = Array.isArray(runs) && runs.length > 0;
    if (pager) {
        pager.style.display = hasRuns ? '' : 'none';
    }
    if (!hasRuns) {
        if (label) label.textContent = 'TCX Run 1/1';
        if (prevBtn) prevBtn.disabled = true;
        if (nextBtn) nextBtn.disabled = true;
        return;
    }
    const safeIndex = Math.min(Math.max(Number(selectedIndex) || 0, 0), runs.length - 1);
    if (label) label.textContent = buildTcxRunLabel(runs[safeIndex], safeIndex, runs.length);
    const disablePaging = runs.length <= 1;
    if (prevBtn) prevBtn.disabled = disablePaging || safeIndex <= 0;
    if (nextBtn) nextBtn.disabled = disablePaging || safeIndex >= runs.length - 1;
}

function updateActiveRunPager() {
    if (currentRunChartSource === 'health_connect') {
        const runs = Array.isArray(currentHealthConnectRuns) ? currentHealthConnectRuns : [];
        const pager = document.getElementById('tcxRunPager');
        const label = document.getElementById('tcxRunPagerLabel');
        const prevBtn = document.getElementById('tcxRunPrevBtn');
        const nextBtn = document.getElementById('tcxRunNextBtn');
        const safeIndex = Math.min(Math.max(Number(currentHealthConnectRunPageIndex) || 0, 0), Math.max(runs.length - 1, 0));
        const run = runs[safeIndex];
        const time = run ? formatSessionRange(run) : '';
        if (pager) pager.style.display = runs.length > 0 ? '' : 'none';
        if (label) label.textContent = runs.length > 0 ? `Health Connect ${safeIndex + 1}/${runs.length}${time ? ` ${time}` : ''}` : 'Health Connect 1/1';
        if (prevBtn) prevBtn.disabled = runs.length <= 1 || safeIndex <= 0;
        if (nextBtn) nextBtn.disabled = runs.length <= 1 || safeIndex >= runs.length - 1;
        return;
    }
    if (currentRunChartSource === 'coros_fit') {
        const runs = Array.isArray(currentCorosFitRuns) ? currentCorosFitRuns : [];
        const pager = document.getElementById('tcxRunPager');
        const label = document.getElementById('tcxRunPagerLabel');
        const prevBtn = document.getElementById('tcxRunPrevBtn');
        const nextBtn = document.getElementById('tcxRunNextBtn');
        const safeIndex = Math.min(Math.max(Number(currentCorosFitRunPageIndex) || 0, 0), Math.max(runs.length - 1, 0));
        if (pager) pager.style.display = runs.length > 0 ? '' : 'none';
        if (label) label.textContent = runs.length > 0 ? buildCorosFitRunLabel(runs[safeIndex], safeIndex, runs.length) : 'COROS FIT 1/1';
        if (prevBtn) prevBtn.disabled = runs.length <= 1 || safeIndex <= 0;
        if (nextBtn) nextBtn.disabled = runs.length <= 1 || safeIndex >= runs.length - 1;
        return;
    }
    updateTcxRunPager(currentTcxRunPages, currentTcxRunPageIndex);
}

function changeTcxRunPage(delta) {
    if (currentRunChartSource === 'health_connect') {
        if (!Array.isArray(currentHealthConnectRuns) || currentHealthConnectRuns.length <= 1) return;
        const nextIndex = Math.min(Math.max(currentHealthConnectRunPageIndex + Number(delta || 0), 0), currentHealthConnectRuns.length - 1);
        if (nextIndex === currentHealthConnectRunPageIndex) return;
        currentHealthConnectRunPageIndex = nextIndex;
        loadData({ triggerAdvice: false });
        return;
    }
    const isCorosFit = currentRunChartSource === 'coros_fit';
    const runs = isCorosFit ? currentCorosFitRuns : currentTcxRunPages;
    const currentIndex = isCorosFit ? currentCorosFitRunPageIndex : currentTcxRunPageIndex;
    if (!Array.isArray(runs) || runs.length <= 1) return;
    const nextIndex = Math.min(
        Math.max(currentIndex + Number(delta || 0), 0),
        runs.length - 1
    );
    if (nextIndex === currentIndex) return;
    if (isCorosFit) currentCorosFitRunPageIndex = nextIndex;
    else currentTcxRunPageIndex = nextIndex;
    loadData({ triggerAdvice: false });
}

function updateRunSourceControls(hasCorosFit, hasTcx) {
    const corosBtn = document.getElementById('corosFitSourceBtn');
    const tcxBtn = document.getElementById('tcxSourceBtn');
    const canSwitchSource = Boolean(hasCorosFit && hasTcx);
    if (corosBtn) {
        corosBtn.style.display = canSwitchSource ? '' : 'none';
        corosBtn.disabled = currentRunChartSource === 'coros_fit';
    }
    if (tcxBtn) {
        tcxBtn.style.display = canSwitchSource ? '' : 'none';
        tcxBtn.disabled = currentRunChartSource === 'tcx';
    }
    const applyBtn = document.getElementById('refreshTcxAdviceBtn');
    if (applyBtn) {
        applyBtn.style.display =
            currentRunChartSource === 'tcx' || currentRunChartSource === 'coros_fit'
                ? ''
                : 'none';
    }
}

function setRunChartSource(source) {
    currentRunChartSource = source === 'coros_fit' ? 'coros_fit' : 'tcx';
    const minuteTitle = document.getElementById('runPerMinuteTitle');
    if (minuteTitle) minuteTitle.textContent = 'Per Minute';
    updateActiveRunPager();
    loadData({ triggerAdvice: false });
}

function buildLapSplitsExportPayload(dateString, sessions = [], data = []) {
    const runSessions = (Array.isArray(sessions) ? sessions : [])
        .filter((session) => Number(session && session.activityType) === 8)
        .sort((a, b) => Number(a && a.startTimeMillis) - Number(b && b.startTimeMillis));
    const normalizedSessions = runSessions.length > 0
        ? runSessions.map((session, index) => {
            const sessionNumber = index + 1;
            const splits = buildPerKmSplitsForSession(data, session, sessionNumber, dateString, runSessions.length);
            return {
                session_number: sessionNumber,
                id: session.id,
                name: session.name,
                activity_type: session.activityType,
                start_time_millis: session.startTimeMillis,
                end_time_millis: session.endTimeMillis,
                start_time_local: formatSessionTimeRange(session).split('-')[0] || '',
                end_time_local: formatSessionTimeRange(session).split('-')[1] || '',
                minute_points_used: Array.isArray(data) ? data.filter((point) => pointBelongsToSession(point, session, dateString)).length : 0,
                splits: splits.map((lap) => ({
                    lap: lap.lapLabel,
                    distance: lap.distanceLabel,
                    avg_speed: lap.avgSpeed,
                    avg_pitch: lap.avgPitch,
                    avg_hr: lap.avgHr,
                    avg_stride: lap.avgStride,
                    distance_meters: lap.distanceMeters,
                    elapsed_seconds: lap.elapsedSeconds
                }))
            };
        })
        : [{
            session_number: 1,
            id: null,
            name: 'All Day',
            activity_type: null,
            start_time_millis: null,
            end_time_millis: null,
            start_time_local: '',
            end_time_local: '',
            minute_points_used: Array.isArray(data) ? data.length : 0,
            splits: buildPerKmSplitsForSession(data, null, 1, dateString, 1).map((lap) => ({
                lap: lap.lapLabel,
                distance: lap.distanceLabel,
                avg_speed: lap.avgSpeed,
                avg_pitch: lap.avgPitch,
                avg_hr: lap.avgHr,
                avg_stride: lap.avgStride,
                distance_meters: lap.distanceMeters,
                elapsed_seconds: lap.elapsedSeconds
            }))
        }];

    return {
        date: dateString,
        generated_at: new Date().toISOString(),
        source: {
            intraday_file: `storage/cache/intraday_${dateString}.json`,
            sessions_file: `storage/cache/sessions_${dateString}.json`
        },
        sessions: normalizedSessions
    };
}

function buildLapSplitsMarkdown(payload) {
    if (!payload || !Array.isArray(payload.sessions) || payload.sessions.length === 0) {
        return '# 1km Splits\n\nNo split data available.';
    }

    const lines = [`# 1km Splits`, ``, `Date: ${payload.date}`, ``];
    payload.sessions.forEach((session) => {
        const title = session.name ? `${session.session_number}. ${session.name}` : `Session ${session.session_number}`;
        lines.push(`## ${title}`);
        if (session.start_time_local || session.end_time_local) {
            lines.push(`- Time: ${session.start_time_local || '-'}-${session.end_time_local || '-'}`);
        }
        lines.push(`- Minute points used: ${session.minute_points_used}`);
        lines.push(``);
        lines.push(`| Lap | Distance | Avg Speed | Avg Pitch | Avg HR | Avg Stride |`);
        lines.push(`|---|---|---:|---:|---:|---:|`);
        (session.splits || []).forEach((lap) => {
            lines.push(`| ${lap.lap} | ${lap.distance} | ${Number(lap.avg_speed || 0).toFixed(1)} | ${lap.avg_pitch || '-'} | ${lap.avg_hr || '-'} | ${Number(lap.avg_stride || 0).toFixed(1)} |`);
        });
        lines.push(``);
    });
    return lines.join('\n');
}

function buildTcxMinuteExportPayload(dateString, rows = []) {
    return {
        date: dateString,
        generated_at: new Date().toISOString(),
        source: {
            tcx_table: 'TCX Per Minute'
        },
        rows: (Array.isArray(rows) ? rows : []).map((row) => ({
            time: row.time,
            distance_m: Number(row.distance || 0),
            raw_distance_m: Number(row.rawDistance || row.distance || 0),
            stride_cm: Number(row.stride || 0),
            speed_kmh: Number(row.speed || 0),
            raw_speed_kmh: Number(row.rawSpeed || row.speed || 0),
            heart_rate: Number(row.heartRate || 0),
            pitch: Number(row.pitch || 0),
            altitude_m: row.altitude === null || row.altitude === undefined ? null : Number(row.altitude),
            coverage_seconds: Number(row.coverageSeconds || 0),
            adjusted: String(row.distanceSource || '') === 'speed-adjusted',
            distance_deviation_rate: Number(row.distanceDeviationRate || 0)
        }))
    };
}

function buildTcxMinuteMarkdown(payload) {
    if (!payload || !Array.isArray(payload.rows) || payload.rows.length === 0) {
        return '# TCX Per Minute\n\nNo TCX minute data available.';
    }

    const lines = [
        '# TCX Per Minute',
        '',
        `Date: ${payload.date}`,
        '',
        '| Time | Dist (m) | Stride (cm) | Speed (km/h) | Heart Rate | Pitch | Altitude (m) |',
        '|---|---:|---:|---:|---:|---:|---:|'
    ];
    payload.rows.forEach((row) => {
        const distanceText = row.adjusted
            ? `${Number(row.distance_m || 0).toFixed(1)} Adjusted (${Number(row.raw_distance_m || 0).toFixed(1)})`
            : `${Number(row.distance_m || 0).toFixed(1)}`;
        const speedText = row.adjusted
            ? `${Number(row.speed_kmh || 0).toFixed(1)} Adjusted (${Number(row.raw_speed_kmh || 0).toFixed(1)})`
            : `${Number(row.speed_kmh || 0).toFixed(1)}`;
        lines.push(
            `| ${row.time} | ${distanceText} | ${Number(row.stride_cm || 0).toFixed(1)} | ${speedText} | ${row.heart_rate > 0 ? row.heart_rate : '-'} | ${row.pitch > 0 ? row.pitch : '-'} | ${row.altitude_m === null ? '-' : Number(row.altitude_m).toFixed(1)} |`
        );
    });
    return lines.join('\n');
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        return true;
    }
    return legacyCopyTextToClipboard(text);
}

function legacyCopyTextToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let ok = false;
    try {
        ok = document.execCommand('copy');
    } finally {
        textarea.remove();
    }
    return ok;
}

function openClipboardModal(title, text) {
    const modal = document.getElementById('clipboardModal');
    const titleEl = document.getElementById('clipboardModalTitle');
    const textarea = document.getElementById('clipboardModalText');
    if (!modal || !titleEl || !textarea) return;
    titleEl.textContent = title;
    textarea.value = text;
    modal.style.display = 'flex';
    textarea.focus();
    textarea.select();
}

function closeClipboardModal() {
    const modal = document.getElementById('clipboardModal');
    if (!modal) return;
    modal.style.display = 'none';
}

async function copyLapSplitsAsJson() {
    if (!currentLapSplitExport) {
        alert('No split data available. Run ANALYZER first.');
        return;
    }
    const text = JSON.stringify(currentLapSplitExport, null, 2);
    const copied = await copyTextToClipboard(text);
    if (copied) {
        alert('JSON copied to clipboard.');
        return;
    }
    openClipboardModal('JSON Output', text);
    alert('Clipboard unavailable. Opened JSON in a copyable window.');
}

async function copyLapSplitsAsMarkdown() {
    if (!currentLapSplitExport) {
        alert('No split data available. Run ANALYZER first.');
        return;
    }
    const text = buildLapSplitsMarkdown(currentLapSplitExport);
    const copied = await copyTextToClipboard(text);
    if (copied) {
        alert('MD copied to clipboard.');
        return;
    }
    openClipboardModal('MD Output', text);
    alert('Clipboard unavailable. Opened MD in a copyable window.');
}

async function copyTcxMinuteAsJson() {
    if (!currentTcxMinuteExport) {
        alert('No TCX minute data available. Run ANALYZER first.');
        return;
    }
    const text = JSON.stringify(currentTcxMinuteExport, null, 2);
    const copied = await copyTextToClipboard(text);
    if (copied) {
        alert('JSON copied to clipboard.');
        return;
    }
    openClipboardModal('JSON Output', text);
    alert('Clipboard unavailable. Opened JSON in a copyable window.');
}

async function copyTcxMinuteAsMarkdown() {
    if (!currentTcxMinuteExport) {
        alert('No TCX minute data available. Run ANALYZER first.');
        return;
    }
    const text = buildTcxMinuteMarkdown(currentTcxMinuteExport);
    const copied = await copyTextToClipboard(text);
    if (copied) {
        alert('MD copied to clipboard.');
        return;
    }
    openClipboardModal('MD Output', text);
    alert('Clipboard unavailable. Opened MD in a copyable window.');
}

function isElementVisibleForExport(element) {
    if (!element) return false;
    if (element.style && element.style.display === 'none') return false;
    return element.offsetParent !== null;
}

function buildVisibleChartsCompositeCanvas() {
    const wrapperIds = [
        'legacyStrideChartWrapper',
        'legacySpeedChartWrapper',
        'fitSpeedChartWrapper',
        'fitPitchChartWrapper',
        'fitStrideChartWrapper',
        'tcxStrideChartWrapper',
        'tcxSpeedPitchChartWrapper'
    ];
    const titleByWrapperId = {
        legacyStrideChartWrapper: 'Stride + HR',
        legacySpeedChartWrapper: 'Speed + Pitch',
        fitSpeedChartWrapper: 'Speed (accurate) + HR (accurate)',
        fitPitchChartWrapper: 'Pitch (accurate)',
        fitStrideChartWrapper: 'Stride (accurate)',
        tcxStrideChartWrapper: 'TCX Stride + HR',
        tcxSpeedPitchChartWrapper: 'TCX Speed + Pitch'
    };
    const wrappers = wrapperIds
        .map((id) => document.getElementById(id))
        .filter((el) => isElementVisibleForExport(el));

    if (wrappers.length === 0) return null;

    const horizontalPadding = 24;
    const verticalPadding = 20;
    const gap = 16;
    const targetWidth = Math.max(...wrappers.map((wrapper) => wrapper.clientWidth || 0));
    if (!(targetWidth > 0)) return null;

    const sections = wrappers.map((wrapper) => {
        const canvas = wrapper.querySelector('canvas');
        if (!canvas) return null;
        const sourceWidth = canvas.width || canvas.clientWidth || targetWidth;
        const sourceHeight = canvas.height || canvas.clientHeight || 320;
        if (!(sourceWidth > 0) || !(sourceHeight > 0)) return null;
        const drawWidth = targetWidth;
        const drawHeight = Math.round(sourceHeight * (drawWidth / sourceWidth));
        return { wrapper, canvas, drawWidth, drawHeight };
    }).filter(Boolean);

    if (sections.length === 0) return null;

    const totalHeight =
        verticalPadding * 2 +
        sections.reduce((sum, section) => sum + section.drawHeight + 30, 0) +
        gap * Math.max(0, sections.length - 1);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = targetWidth + horizontalPadding * 2;
    exportCanvas.height = totalHeight;
    const ctx = exportCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#111111';
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    let currentY = verticalPadding;
    sections.forEach((section) => {
        const titleText = titleByWrapperId[section.wrapper.id] || 'Chart';

        ctx.fillStyle = '#1a1a1a';
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1;
        ctx.fillRect(12, currentY - 8, exportCanvas.width - 24, section.drawHeight + 38);
        ctx.strokeRect(12.5, currentY - 7.5, exportCanvas.width - 25, section.drawHeight + 37);

        ctx.fillStyle = '#eeeeee';
        ctx.font = '600 16px Inter, sans-serif';
        ctx.fillText(titleText, horizontalPadding, currentY + 6);

        ctx.drawImage(section.canvas, horizontalPadding, currentY + 14, section.drawWidth, section.drawHeight);
        currentY += section.drawHeight + 30 + gap;
    });

    return exportCanvas;
}

function buildVisibleMinuteTablesMarkdown() {
    const tableDefs = [
        { wrapperId: 'legacyPerMinuteWrapper', tableId: 'resultTable', title: 'Per Minute' },
        { wrapperId: 'tcxPerMinuteWrapper', tableId: 'tcxResultTable', title: 'TCX Per Minute' }
    ];
    const sections = [];

    tableDefs.forEach(({ wrapperId, tableId, title }) => {
        const wrapper = document.getElementById(wrapperId);
        const table = document.getElementById(tableId);
        if (!isElementVisibleForExport(wrapper) || !table) return;

        const headers = Array.from(table.querySelectorAll('thead th'))
            .map((th) => String(th.textContent || '').trim())
            .filter(Boolean);
        const rows = Array.from(table.querySelectorAll('tbody tr'))
            .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => String(td.textContent || '').trim()))
            .filter((cells) => cells.length > 0 && cells.some((cell) => cell));

        if (headers.length === 0 || rows.length === 0) return;
        if (rows.length === 1 && rows[0].some((cell) => /^No\b/i.test(cell))) return;

        const lines = [
            `## ${title}`,
            `| ${headers.join(' | ')} |`,
            `| ${headers.map(() => '---').join(' | ')} |`,
            ...rows.map((cells) => `| ${cells.join(' | ')} |`)
        ];
        sections.push(lines.join('\n'));
    });

    return sections.join('\n\n').trim();
}

async function copyCanvasImageToClipboard(canvas) {
    if (!canvas) return false;
    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') {
        return false;
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
}

function downloadCanvasAsPng(canvas, filename) {
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

async function copyVisibleTcxChartsAsImage() {
    const exportCanvas = buildVisibleChartsCompositeCanvas();
    if (!exportCanvas) {
        alert('No visible TCX charts available. Run ANALYZER on a TCX day first.');
        return;
    }

    const copied = await copyCanvasImageToClipboard(exportCanvas);
    if (copied) {
        alert('TCX charts copied to clipboard as PNG.');
        return;
    }

    const dateString = normalizeRunDate(document.getElementById('dateInput')?.value || '') || 'tcx-charts';
    downloadCanvasAsPng(exportCanvas, `${dateString}-tcx-charts.png`);
    alert('Clipboard image copy is unavailable in this browser. Downloaded PNG instead.');
}

async function loadData(options = {}) {
    const triggerAdvice = !!(options && options.triggerAdvice);
    const syncSummary = !!(options && options.syncSummary);
    const dateInput = document.getElementById('dateInput');
    const date = dateInput.value;
    const sessionSummaryContainer = document.getElementById('sessionSummary');
    const summaryContainer = document.getElementById('summary');
    const lapTbody = document.querySelector('#lapTable tbody');
    const tbody = document.querySelector('#resultTable tbody');
    const tcxTbody = document.querySelector('#tcxResultTable tbody');
    const tcxLapTbody = document.querySelector('#tcxLapTable tbody');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const syncJsonBtn = document.getElementById('syncJsonBtn');
    setLapExportState(null);
    setTcxExportState(null);

    if (analyzeBtn) analyzeBtn.disabled = true;
    if (syncJsonBtn) syncJsonBtn.disabled = true;
    if (syncSummary) {
        if (syncJsonBtn) syncJsonBtn.textContent = 'SYNCING...';
    } else {
        if (analyzeBtn) analyzeBtn.textContent = 'ANALYZING...';
    }
    if (lapTbody) {
        lapTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">Loading splits...</td></tr>';
    }
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">Loading data...</td></tr>';
    if (tcxTbody) {
        tcxTbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: var(--text-secondary);">Loading TCX data...</td></tr>';
    }
    if (tcxLapTbody) {
        tcxLapTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">Loading TCX splits...</td></tr>';
    }

    // Clear advice message first
    const msgContainer = document.getElementById('daily-message-container');
    const msgText = document.getElementById('daily-message-text');
    if (msgContainer) msgContainer.style.display = 'none';
    if (msgText) msgText.textContent = '';
    if (sessionSummaryContainer) sessionSummaryContainer.innerHTML = '';

    try {
        const qs = new URLSearchParams({ date: String(date || '').trim() });
        if (syncSummary) qs.set('sync', '1');
        const [res, fitSpeedSeriesRaw, fitHeartRateSeriesRaw, fitPitchSeries, fitStrideSeries, tcxRuns, corosFitRuns] = await Promise.all([
            fetch(`/api/stride?${qs.toString()}`),
            fetchDetailedFitSpeedSeries(date).catch(() => []),
            fetchDetailedFitHeartRateSeries(date).catch(() => []),
            fetchDetailedFitPitchSeries(date).catch(() => []),
            fetchDetailedFitStrideSeries(date).catch(() => []),
            fetchTcxRuns(date).catch(() => []),
            fetchCorosFitRuns(date).catch(() => [])
        ]);
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(errText || 'Failed to fetch data');
        }

        const data = await res.json();
        const dailySummary = await fetchDailySummary(date);
        const sessions = await fetchDailySessions(date);
        currentTcxRunPages = Array.isArray(tcxRuns) ? tcxRuns : [];
        currentCorosFitRuns = Array.isArray(corosFitRuns) ? corosFitRuns : [];
        currentHealthConnectRuns = (Array.isArray(sessions) ? sessions : [])
            .filter((session) => Number(session?.activityType) === 8)
            .sort((a, b) => Number(a?.startTimeMillis || 0) - Number(b?.startTimeMillis || 0));
        if (currentTcxRunPageDate !== date) {
            currentTcxRunPageIndex = 0;
        }
        if (currentCorosFitRunPageDate !== date) {
            currentCorosFitRunPageIndex = 0;
        }
        if (currentHealthConnectRunPageDate !== date) {
            currentHealthConnectRunPageIndex = 0;
        }
        currentTcxRunPageDate = date;
        currentCorosFitRunPageDate = date;
        currentHealthConnectRunPageDate = date;
        if (currentTcxRunPageIndex >= currentTcxRunPages.length) {
            currentTcxRunPageIndex = Math.max(currentTcxRunPages.length - 1, 0);
        }
        if (currentCorosFitRunPageIndex >= currentCorosFitRuns.length) {
            currentCorosFitRunPageIndex = Math.max(currentCorosFitRuns.length - 1, 0);
        }
        if (currentHealthConnectRunPageIndex >= currentHealthConnectRuns.length) {
            currentHealthConnectRunPageIndex = Math.max(currentHealthConnectRuns.length - 1, 0);
        }
        const selectedTcxRun = currentTcxRunPages.length > 0
            ? currentTcxRunPages[currentTcxRunPageIndex]
            : null;
        const hasTcxRunData = currentTcxRunPages.length > 0;
        const hasCorosFitRunData = currentCorosFitRuns.length > 0;
        const hasHealthConnectRunData = currentHealthConnectRuns.length > 0;
        if (currentRunChartSource === 'coros_fit' && !hasCorosFitRunData) currentRunChartSource = hasTcxRunData ? 'tcx' : 'coros_fit';
        if (currentRunChartSource === 'tcx' && !hasTcxRunData && hasCorosFitRunData) currentRunChartSource = 'coros_fit';
        if (!hasTcxRunData && !hasCorosFitRunData && hasHealthConnectRunData) currentRunChartSource = 'health_connect';
        if (currentRunChartSource === 'health_connect' && !hasHealthConnectRunData) currentRunChartSource = hasCorosFitRunData ? 'coros_fit' : 'tcx';
        updateRunSourceControls(hasCorosFitRunData, hasTcxRunData);
        updateActiveRunPager();
        const tcxMinutePayload = selectedTcxRun
            ? await fetchTcxMinuteSeries(date, selectedTcxRun.runId).catch(() => ({ chartData: [], altitudeDetail: [] }))
            : { chartData: [], altitudeDetail: [] };
        const tcxMinuteData = Array.isArray(tcxMinutePayload?.chartData) ? tcxMinutePayload.chartData : [];
        const tcxAltitudeDetail = Array.isArray(tcxMinutePayload?.altitudeDetail) ? tcxMinutePayload.altitudeDetail : [];
        const tcxLapSplits = selectedTcxRun
            ? await fetchTcxSplits(date, selectedTcxRun.runId).catch(() => [])
            : [];
        const selectedCorosFitRun = getSelectedCorosFitRun();
        const corosFitMinutePayload = currentRunChartSource === 'coros_fit' && selectedCorosFitRun
            ? await fetchCorosFitMinuteSeries(date, selectedCorosFitRun.labelId).catch(() => ({ chartData: [] }))
            : { chartData: [] };
        const corosFitMinuteData = Array.isArray(corosFitMinutePayload?.chartData) ? corosFitMinutePayload.chartData : [];
        const selectedHealthConnectRun = hasHealthConnectRunData ? currentHealthConnectRuns[currentHealthConnectRunPageIndex] : null;
        const healthConnectMinuteData = selectedHealthConnectRun
            ? (Array.isArray(data) ? data.filter((point) => pointBelongsToSession(point, selectedHealthConnectRun, date)) : [])
            : (Array.isArray(data) ? data : []);
        const activeMinuteData = currentRunChartSource === 'coros_fit'
            ? corosFitMinuteData
            : (currentRunChartSource === 'health_connect' ? healthConnectMinuteData : tcxMinuteData);
        const activeAltitudeDetail = currentRunChartSource === 'coros_fit' || currentRunChartSource === 'health_connect'
            ? activeMinuteData.filter((row) => Number.isFinite(Number(row?.altitude))).map((row) => ({ timestampMs: Number(row.bucketStartMs), time: row.time, altitude: Number(row.altitude) }))
            : tcxAltitudeDetail;
        const minuteTitle = document.getElementById('runPerMinuteTitle');
        if (minuteTitle) minuteTitle.textContent = 'Per Minute';
        const selectedActiveRange = currentRunChartSource === 'health_connect' && selectedHealthConnectRun
            ? { startMs: Number(selectedHealthConnectRun.startTimeMillis), endMs: Number(selectedHealthConnectRun.endTimeMillis) }
            : getTcxRowsTimeRange(activeMinuteData);
        const fitSpeedSeries = selectedActiveRange
            ? filterDetailedSeriesByRange(fitSpeedSeriesRaw, selectedActiveRange)
            : fitSpeedSeriesRaw;
        const fitHeartRateSeries = selectedActiveRange
            ? filterDetailedSeriesByRange(fitHeartRateSeriesRaw, selectedActiveRange)
            : fitHeartRateSeriesRaw;
        const hasActiveMinuteData = Array.isArray(activeMinuteData) && activeMinuteData.length > 0;
        const hasRunData = hasTcxRunData || hasCorosFitRunData || hasHealthConnectRunData;
        const chartDisplayData = hasActiveMinuteData
            ? activeMinuteData.map((row) => ({
                time: String(row?.time || '--:--'),
                steps: Number(row?.pitch || 0),
                distance: Number(row?.distance || 0),
                stride: Number(row?.stride || 0),
                speed: Number(row?.speed || 0),
                heartRate: Number(row?.heartRate || 0),
                pitch: Number(row?.pitch || 0)
            }))
            : (Array.isArray(data) ? data : []);
        placeDailyMessageContainerInsidePager(hasRunData);
        currentAdviceRunDate = date;
        currentAdviceUsesTcx = currentRunChartSource === 'tcx' && tcxMinuteData.length > 0;
        currentAdviceData = currentAdviceUsesTcx
            ? (Array.isArray(tcxMinuteData) ? tcxMinuteData : [])
            : (Array.isArray(data) ? data : []);
        setLegacyChartVisibility(
            currentRunChartSource === 'tcx' && hasTcxRunData,
            currentRunChartSource === 'coros_fit' && hasCorosFitRunData
        );
        setLapExportState(buildLapSplitsExportPayload(date, sessions, data));
        setTcxExportState(buildTcxMinuteExportPayload(date, activeMinuteData));
        if (lapTbody) {
            renderLapTableRows(lapTbody, buildPerKmSplits(data, sessions, date));
        }
        tbody.innerHTML = '';
        if (tcxTbody) {
            renderTcxMinuteTableRows(tcxTbody, activeMinuteData);
        }
        if (tcxLapTbody) {
            renderTcxLapTableRows(tcxLapTbody, currentRunChartSource === 'tcx' ? tcxLapSplits : []);
        }
        renderTcxMinuteCharts(activeMinuteData, activeAltitudeDetail);

        let max = { stride: 0, time: '--:--' };

        if (chartDisplayData.length === 0) {
            // Guard Clause: Handle No Data (Rest Day)
            if (strideChartInstance) {
                strideChartInstance.destroy(); // Safety: Destroy existing chart
            }
            if (speedChartInstance) {
                speedChartInstance.destroy();
            }
            clearFitSpeedChart();
            clearFitPitchChart();
            clearFitStrideChart();
            setFitDetailChartAvailability({ speed: false, pitch: false, stride: false });
            clearTcxStrideChart();
            clearTcxSpeedPitchChart();
            if (lapTbody) {
                lapTbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">No 1km splits</td></tr>';
            }
            setLapExportState(null);
            setTcxExportState(buildTcxMinuteExportPayload(date, tcxMinuteData));
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">No Running Data (Rest Day)</td></tr>';
            if (tcxTbody) {
                renderTcxMinuteTableRows(tcxTbody, tcxMinuteData);
            }
            if (tcxLapTbody) {
                renderTcxLapTableRows(tcxLapTbody, tcxLapSplits);
            }
            if (sessionSummaryContainer) sessionSummaryContainer.innerHTML = '';
            summaryContainer.innerHTML = ''; // Clear summary

            // Reset chart area to be blank/clean
            const ctx = document.getElementById('strideChart').getContext('2d');
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            const speedCtx = document.getElementById('speedChart').getContext('2d');
            speedCtx.clearRect(0, 0, speedCtx.canvas.width, speedCtx.canvas.height);
            const fitSpeedCtx = document.getElementById('fitSpeedChart').getContext('2d');
            fitSpeedCtx.clearRect(0, 0, fitSpeedCtx.canvas.width, fitSpeedCtx.canvas.height);
            const fitPitchCtx = document.getElementById('fitPitchChart').getContext('2d');
            fitPitchCtx.clearRect(0, 0, fitPitchCtx.canvas.width, fitPitchCtx.canvas.height);
            const fitStrideCtx = document.getElementById('fitStrideChart').getContext('2d');
            fitStrideCtx.clearRect(0, 0, fitStrideCtx.canvas.width, fitStrideCtx.canvas.height);
            const tcxStrideCtx = document.getElementById('tcxStrideChart').getContext('2d');
            tcxStrideCtx.clearRect(0, 0, tcxStrideCtx.canvas.width, tcxStrideCtx.canvas.height);
            const tcxSpeedPitchCtx = document.getElementById('tcxSpeedPitchChart').getContext('2d');
            tcxSpeedPitchCtx.clearRect(0, 0, tcxSpeedPitchCtx.canvas.width, tcxSpeedPitchCtx.canvas.height);

            if (Array.isArray(tcxMinuteData) && tcxMinuteData.length > 0) {
                renderTcxMinuteCharts(tcxMinuteData, tcxAltitudeDetail);
            }

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

        // Peak Performance Calculation
        let maxStrideVal = 0;
        let maxIndex = 0;

        chartDisplayData.forEach((d, i) => {
            // Peak stride highlight should reflect the actual maximum stride in the run.
            const val = d.stride;
            if (val > maxStrideVal) {
                maxStrideVal = val;
                maxIndex = i;
            }
        });

        const intradayMaxStride = maxStrideVal;
        const intradayMaxTime = chartDisplayData[maxIndex].time;

        chartDisplayData.forEach(d => {
            const velocityKmH = Number.isFinite(Number(d.speed)) && Number(d.speed) > 0
                ? Number(d.speed)
                : (d.distance / 1000) * 60;
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
        let maxCadence = 0;
        let sumCadence = 0;
        let countCadence = 0;
        let maxSpeed = 0;
        let sumSpeed = 0;
        let countSpeed = 0;
        chartDisplayData.forEach(d => {
            if (d.heartRate > 0) {
                if (d.heartRate > maxHR) maxHR = d.heartRate;
                sumHR += d.heartRate;
                countHR++;
            }
            if (d.steps > maxCadence) maxCadence = d.steps;
            if (d.steps > 140) {
                sumCadence += d.steps;
                countCadence++;
            }
            if (d.speed > 0) {
                sumSpeed += d.speed;
                countSpeed++;
            }
            if (d.speed > maxSpeed) maxSpeed = d.speed;
        });
        const avgHR = countHR > 0 ? (sumHR / countHR) : 0;
        const avgCadence = countCadence > 0 ? (sumCadence / countCadence) : 0;
        const avgSpeed = countSpeed > 0 ? (sumSpeed / countSpeed) : 0;

        const totalSeconds = Math.max(0, chartDisplayData.length * 60);
        const totalSteps = chartDisplayData.reduce((acc, d) => acc + (Number(d.steps) || 0), 0);
        const totalDistanceMeters = chartDisplayData.reduce((acc, d) => acc + (Number(d.distance) || 0), 0);
        const intradaySummaryMetrics = {
            maxStride: intradayMaxStride,
            maxTime: intradayMaxTime,
            maxHR,
            avgHR,
            maxCadence,
            avgCadence,
            maxSpeed,
            avgSpeed,
            totalSeconds,
            totalSteps,
            totalDistanceMeters
        };
        const tcxSummaryMetrics = Array.isArray(tcxMinuteData) && tcxMinuteData.length > 0
            ? buildTcxSummaryMetrics(tcxMinuteData)
            : null;
        const peakMetrics = buildLegacyPeakMetrics(dailySummary, tcxSummaryMetrics, intradaySummaryMetrics);
        const totalGap = WR_STRIDE - peakMetrics.maxStride;
        const heartRateGuide = getHeartRateZoneGuide();
        if (sessionSummaryContainer) {
            sessionSummaryContainer.innerHTML = renderSessionSummary(sessions);
        }
        summaryContainer.innerHTML = renderSummary(
            peakMetrics.maxStride,
            peakMetrics.maxTime || intradayMaxTime,
            totalGap,
            peakMetrics.maxHR,
            peakMetrics.avgHR,
            peakMetrics.maxCadence,
            peakMetrics.avgCadence,
            peakMetrics.maxSpeed,
            peakMetrics.avgSpeed,
            peakMetrics.totalSeconds,
            peakMetrics.totalSteps,
            peakMetrics.totalDistanceMeters,
            heartRateGuide
        );

        // --- Render Chart ---
        renderChart(chartDisplayData);
        if (Array.isArray(fitSpeedSeries) && fitSpeedSeries.length > 0) {
            renderDetailedFitSpeedChart(fitSpeedSeries, fitHeartRateSeries);
        } else {
            clearFitSpeedChart();
        }
        if (Array.isArray(fitPitchSeries) && fitPitchSeries.length > 0) {
            renderDetailedFitPitchChart(fitPitchSeries);
        } else {
            clearFitPitchChart();
        }
        if (Array.isArray(fitStrideSeries) && fitStrideSeries.length > 0) {
            renderDetailedFitStrideChart(fitStrideSeries);
        } else {
            clearFitStrideChart();
        }
        const tcxDetailMode = currentRunChartSource === 'tcx' && hasTcxRunData;
        setFitDetailChartAvailability({
            speed: Array.isArray(fitSpeedSeries) && fitSpeedSeries.length > 0,
            pitch: !tcxDetailMode && Array.isArray(fitPitchSeries) && fitPitchSeries.length > 0,
            stride: !tcxDetailMode && Array.isArray(fitStrideSeries) && fitStrideSeries.length > 0
        });

        // --- Check & Render Images ---
        checkAndRenderImages(date);

        const canTriggerAdvice =
            triggerAdvice &&
            !getSelectedAdviceRunId() &&
            shouldTriggerAdvice(date, dailySummary) &&
            hasRunningDataForAdvice(data);

        // --- Call AI Advice (only when daily_summary exists and message is empty) ---
        if (canTriggerAdvice) {
            try {
                if (isGeminiEnabled()) {
                    await getGeminiAdvice(date, peakMetrics.maxStride, data);
                } else if (isOpenAiEnabled()) {
                    await getOpenAiAdvice(date, peakMetrics.maxStride, data);
                } else {
                    await renderSavedAdvice(dailySummary);
                }
            } catch (adviceError) {
                console.error('Auto advice failed:', adviceError);
            }
        } else {
            await renderSavedAdvice(dailySummary);
        }

    } catch (error) {
        console.error(error);
        currentTcxRunPages = [];
        currentTcxRunPageIndex = 0;
        currentCorosFitRuns = [];
        currentCorosFitRunPageIndex = 0;
        currentHealthConnectRuns = [];
        currentHealthConnectRunPageIndex = 0;
        currentAdviceRunDate = '';
        currentAdviceData = [];
        currentAdviceUsesTcx = false;
        updateTcxRunPager([], 0);
        setLegacyChartVisibility(false);
        setFitDetailChartAvailability({ speed: false, pitch: false, stride: false });
        setLapExportState(null);
        setTcxExportState(null);
        if (sessionSummaryContainer) sessionSummaryContainer.innerHTML = '';
        if (lapTbody) {
            lapTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #f43f5e;">Error loading splits: ${error.message}</td></tr>`;
        }
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #f43f5e;">Error loading data: ${error.message}</td></tr>`;
        if (tcxTbody) {
            tcxTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px; color: #f43f5e;">Error loading TCX data: ${error.message}</td></tr>`;
        }
        if (tcxLapTbody) {
            tcxLapTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #f43f5e;">Error loading TCX splits: ${error.message}</td></tr>`;
        }
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

function buildPerKmSplits(data, sessions = [], dateString = '') {
    const runSessions = (Array.isArray(sessions) ? sessions : [])
        .filter((session) => Number(session && session.activityType) === 8)
        .sort((a, b) => Number(a && a.startTimeMillis) - Number(b && b.startTimeMillis));
    if (runSessions.length === 0) {
        return buildPerKmSplitsForSession(data, null, 1, dateString);
    }

    return runSessions.flatMap((session, index) => buildPerKmSplitsForSession(data, session, index + 1, dateString, runSessions.length));
}

function buildPerKmSplitsForSession(data, session, sessionNumber = 1, dateString = '', totalSessions = 1) {
    const splits = [];
    let cumulativeMeters = 0;
    let nextBoundaryMeters = 1000;
    let lap = createEmptyLapAccumulator(1);
    const sessionPoints = Array.isArray(data)
        ? data.filter((point) => pointBelongsToSession(point, session, dateString))
        : [];

    sessionPoints.forEach((point) => {
        let pointDistanceMeters = Math.max(0, Number(point.distance) || 0);
        let pointTimeSeconds = Number(point.distancePointDurationSeconds) > 0
            ? Number(point.distancePointDurationSeconds)
            : (pointDistanceMeters > 0 ? 60 : 0);
        if (!(pointDistanceMeters > 0)) return;

        while (pointDistanceMeters > 0) {
            const metersToBoundary = nextBoundaryMeters - cumulativeMeters;
            const takeMeters = Math.min(pointDistanceMeters, metersToBoundary);
            const fraction = takeMeters / pointDistanceMeters;
            const timeSeconds = pointTimeSeconds * fraction;
            const pointPitch = Number(point.pitch) > 0 ? Number(point.pitch) : Number(point.steps);
            const pointPitchSecondsRaw = Number(point.stepsPointDurationSeconds) > 0
                ? Number(point.stepsPointDurationSeconds)
                : pointTimeSeconds;
            const pointPitchSeconds = pointPitchSecondsRaw * fraction;

            lap.distanceMeters += takeMeters;
            lap.timeSeconds += timeSeconds;
            if (pointPitch > 0) {
                lap.pitchWeighted += pointPitch * pointPitchSeconds;
                lap.pitchTimeSeconds += pointPitchSeconds;
            }
            if (Number(point.heartRate) > 0) {
                lap.hrWeighted += Number(point.heartRate) * timeSeconds;
                lap.hrTimeSeconds += timeSeconds;
            }
            if (Number(point.stride) > 0) {
                lap.strideWeighted += Number(point.stride) * takeMeters;
                lap.strideDistanceMeters += takeMeters;
            }

            cumulativeMeters += takeMeters;
            pointDistanceMeters -= takeMeters;
            pointTimeSeconds -= timeSeconds;

            if (Math.abs(cumulativeMeters - nextBoundaryMeters) < 0.0001) {
                splits.push(finalizeLapAccumulator(lap, sessionNumber, totalSessions));
                lap = createEmptyLapAccumulator(lap.index + 1);
                nextBoundaryMeters += 1000;
            }
        }
    });

    if (lap.distanceMeters > 0) {
        splits.push(finalizeLapAccumulator(lap, sessionNumber, totalSessions));
    }

    return splits;
}

function pointBelongsToSession(point, session, dateString) {
    if (!session) return true;
    const pointMillis = Number.isFinite(Number(point && point.bucketStartMs))
        ? Number(point.bucketStartMs)
        : (Number.isFinite(Number(point && point.timestampMs)) ? Number(point.timestampMs) : NaN);
    const startMillis = Number(session && session.startTimeMillis);
    const endMillis = Number(session && session.endTimeMillis);
    if (!Number.isFinite(pointMillis) || !Number.isFinite(startMillis) || !Number.isFinite(endMillis)) return false;
    return pointMillis >= startMillis && pointMillis <= endMillis;
}

function pointTimeToMillis(dateString, timeText) {
    const date = String(dateString || '').trim();
    const time = String(timeText || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

function createEmptyLapAccumulator(index) {
    return {
        index,
        distanceMeters: 0,
        timeSeconds: 0,
        pitchWeighted: 0,
        pitchTimeSeconds: 0,
        hrWeighted: 0,
        hrTimeSeconds: 0,
        strideWeighted: 0,
        strideDistanceMeters: 0
    };
}

function finalizeLapAccumulator(lap, sessionNumber = 1, totalSessions = 1) {
    const avgSpeed = lap.timeSeconds > 0
        ? Number(((lap.distanceMeters / lap.timeSeconds) * 3.6).toFixed(1))
        : 0;
    const avgPitch = lap.pitchTimeSeconds > 0 ? Math.round(lap.pitchWeighted / lap.pitchTimeSeconds) : 0;
    const avgHr = lap.hrTimeSeconds > 0 ? Math.round(lap.hrWeighted / lap.hrTimeSeconds) : 0;
    const avgStride = lap.strideDistanceMeters > 0 ? Number((lap.strideWeighted / lap.strideDistanceMeters).toFixed(1)) : 0;
    const lapStartKm = lap.index - 1;
    const lapEndKm = lapStartKm + (lap.distanceMeters / 1000);

    return {
        lapLabel: totalSessions > 1 ? `S${sessionNumber}-${lap.index}` : String(lap.index),
        distanceLabel: `${lapStartKm.toFixed(1)}-${lapEndKm.toFixed(1)} km`,
        avgSpeed,
        avgPitch,
        avgHr,
        avgStride,
        distanceMeters: Number(lap.distanceMeters.toFixed(1)),
        elapsedSeconds: Number(lap.timeSeconds.toFixed(1))
    };
}

function hmsToSeconds(text) {
    const parts = String(text || '').trim().split(':').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
        return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
    }
    if (parts.length === 2 && parts.every(Number.isFinite)) {
        return Math.max(0, parts[0] * 60 + parts[1]);
    }
    return 0;
}

function buildTcxSummaryMetrics(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return null;

    let totalDistanceMeters = 0;
    let totalSeconds = 0;
    let totalSteps = 0;
    let maxStride = 0;
    let maxTime = '--:--';
    let maxHR = 0;
    let sumHR = 0;
    let countHR = 0;
    let maxCadence = 0;
    let sumCadence = 0;
    let countCadence = 0;
    let maxSpeed = 0;
    let sumSpeed = 0;
    let countSpeed = 0;

    rows.forEach((row) => {
        const distance = Number(row?.distance) || 0;
        const coverageSeconds = Number(row?.coverageSeconds) || 0;
        const stride = Number(row?.stride) || 0;
        const heartRate = Number(row?.heartRate) || 0;
        const pitch = Number(row?.pitch) || 0;
        const speed = Number(row?.speed) || 0;

        totalDistanceMeters += distance;
        totalSeconds += coverageSeconds;
        if (pitch > 0 && coverageSeconds > 0) {
            totalSteps += (pitch * coverageSeconds) / 60;
            sumCadence += pitch;
            countCadence += 1;
            if (pitch > maxCadence) maxCadence = pitch;
        }
        if (stride > maxStride) {
            maxStride = stride;
            maxTime = String(row?.time || '--:--');
        }
        if (heartRate > 0) {
            sumHR += heartRate;
            countHR += 1;
            if (heartRate > maxHR) maxHR = heartRate;
        }
        if (speed > 0) {
            sumSpeed += speed;
            countSpeed += 1;
            if (speed > maxSpeed) maxSpeed = speed;
        }
    });

    return {
        maxStride: Number(maxStride.toFixed(1)),
        maxTime,
        maxHR,
        avgHR: countHR > 0 ? (sumHR / countHR) : 0,
        maxCadence,
        avgCadence: countCadence > 0 ? (sumCadence / countCadence) : 0,
        maxSpeed,
        avgSpeed: countSpeed > 0 ? (sumSpeed / countSpeed) : 0,
        totalSeconds,
        totalSteps: Math.round(totalSteps),
        totalDistanceMeters
    };
}

function buildLegacyPeakMetrics(summary, tcxSummaryMetrics, intradaySummaryMetrics) {
    const fallback = tcxSummaryMetrics || intradaySummaryMetrics || {
        maxStride: 0,
        maxTime: '--:--',
        maxHR: 0,
        avgHR: 0,
        maxCadence: 0,
        avgCadence: 0,
        maxSpeed: 0,
        avgSpeed: 0,
        totalSeconds: 0,
        totalSteps: 0,
        totalDistanceMeters: 0
    };

    if (!(summary && typeof summary === 'object')) {
        return fallback;
    }

    return {
        maxStride: Number(summary?.max_stride) > 0 ? Number(summary.max_stride) : fallback.maxStride,
        maxTime: fallback.maxTime,
        maxHR: Number(summary?.hr_max) > 0 ? Number(summary.hr_max) : fallback.maxHR,
        avgHR: Number(summary?.hr_avg) > 0 ? Number(summary.hr_avg) : fallback.avgHR,
        maxCadence: Number(summary?.max_cadence) > 0 ? Number(summary.max_cadence) : fallback.maxCadence,
        avgCadence: Number(summary?.avg_cadence) > 0 ? Number(summary.avg_cadence) : fallback.avgCadence,
        maxSpeed: Number(summary?.max_speed) > 0 ? Number(summary.max_speed) : fallback.maxSpeed,
        avgSpeed: Number(summary?.avg_speed) > 0 ? Number(summary.avg_speed) : fallback.avgSpeed,
        totalSeconds: (summary?.total_time && String(summary.total_time).trim())
            ? hmsToSeconds(String(summary.total_time).trim())
            : fallback.totalSeconds,
        totalSteps: Number(summary?.step_count) > 0 ? Number(summary.step_count) : fallback.totalSteps,
        totalDistanceMeters: Number(summary?.total_distance_km) > 0
            ? Number(summary.total_distance_km) * 1000
            : fallback.totalDistanceMeters
    };
}

function renderLapTableRows(tbody, splits) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!Array.isArray(splits) || splits.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">No 1km splits</td></tr>';
        return;
    }

    splits.forEach((lap) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${lap.lapLabel}</td>
            <td>${lap.distanceLabel}</td>
            <td style="color: #7af0b8; font-weight: bold;">${lap.avgSpeed > 0 ? lap.avgSpeed.toFixed(1) : '-'}</td>
            <td style="color: #ffd166;">${lap.avgPitch > 0 ? lap.avgPitch : '-'}</td>
            <td style="color: #ff9999;">${lap.avgHr > 0 ? lap.avgHr : '-'}</td>
            <td>${lap.avgStride > 0 ? lap.avgStride.toFixed(1) : '-'}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function buildAdvicePayload(date, maxStride, data) {
    const normalizedData = (Array.isArray(data) ? data : []).map((d) => ({
        stride: Number(d?.stride || 0),
        cadence: Number(d?.steps || d?.pitch || 0),
        distance: Number(d?.distance || 0),
        speed: Number(d?.speed || 0),
        heartRate: Number(d?.heartRate || 0),
        coverageSeconds: Number(d?.coverageSeconds) > 0 ? Number(d.coverageSeconds) : 60
    }));

    const runningData = normalizedData.filter(d => d.cadence > 140);
    const totalRunningSteps = runningData.reduce((acc, d) => acc + d.cadence, 0);
    const avgStride = totalRunningSteps > 0 ? (runningData.reduce((acc, d) => acc + (d.stride * d.cadence), 0) / totalRunningSteps) : 0;
    const totalSteps = normalizedData.reduce((acc, d) => acc + (Number(d.cadence) || 0), 0);
    const totalDistanceKm = normalizedData.reduce((acc, d) => acc + (Number(d.distance) || 0), 0) / 1000;
    const totalSeconds = Math.max(0, normalizedData.reduce((acc, d) => {
        const coverageSeconds = Number(d.coverageSeconds) > 0 ? Number(d.coverageSeconds) : 60;
        return acc + coverageSeconds;
    }, 0));
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
    normalizedData.forEach(d => {
        if (d.cadence > maxCadence) maxCadence = d.cadence;
        if (d.cadence > 140) {
            sumCadence += d.cadence;
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
    const heartRateGuide = getHeartRateZoneGuide();
    const lthrMatch = String(heartRateGuide.maxText || '').match(/LTHR:\s*(\d+)/i);
    const lthr = lthrMatch ? Number(lthrMatch[1]) : 0;
    let lthrExceededSeconds = 0;
    normalizedData.forEach(d => {
        const coverageSeconds = Number(d.coverageSeconds) > 0 ? Number(d.coverageSeconds) : 60;
        if (d.heartRate > 0) {
            sumHR += d.heartRate;
            countHR += 1;
            if (lthr > 0 && Number(d.heartRate) > lthr) {
                lthrExceededSeconds += coverageSeconds;
            }
        }
        if (d.heartRate > maxHR) maxHR = d.heartRate;
    });
    const avgHR = countHR > 0 ? (sumHR / countHR) : 0;
    const lthrExceededRatio = totalSeconds > 0 ? (lthrExceededSeconds / totalSeconds) : 0;

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
        maxSpeed: Number(summary?.max_speed) > 0 ? Number(summary.max_speed) : Number((maxSpeed || 0).toFixed(1)),
        lthr: lthr > 0 ? lthr : null,
        lthrExceededSeconds: Math.round(lthrExceededSeconds),
        lthrExceededRatio: Number(lthrExceededRatio.toFixed(3))
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
        const selectedRunId = getSelectedAdviceRunId();
        if (selectedRunId) {
            payload.runId = selectedRunId;
        }
        const res = await fetch('/api/advice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `API ${res.status}`);
        const normalizedAdvice = String(json.advice || '').trim() || 'No advice returned.';
        textSpan.textContent = normalizedAdvice;
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
        const selectedRunId = getSelectedAdviceRunId();
        if (selectedRunId) {
            payload.runId = selectedRunId;
        }
        const chartCanvas = buildVisibleChartsCompositeCanvas();
        const minuteTableMarkdown = buildVisibleMinuteTablesMarkdown();
        if (chartCanvas) {
            payload.chartImageDataUrl = chartCanvas.toDataURL('image/png');
        }
        if (minuteTableMarkdown) {
            payload.minuteTableMarkdown = minuteTableMarkdown;
            console.log('[Gemini payload] minuteTableMarkdown\n' + minuteTableMarkdown);
        } else {
            console.log('[Gemini payload] minuteTableMarkdown is empty');
        }
        const res = await fetch('/api/advice/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `API ${res.status}`);
        const normalizedAdvice = String(json.advice || '').trim() || 'No advice returned.';
        textSpan.textContent = normalizedAdvice;
    } catch (e) {
        textSpan.textContent = `Gemini Advice Failed: ${e.message}`;
    }
}

async function applySelectedRunAdviceFromCurrentView() {
    const selectedRun = getSelectedActiveRun();
    const visibleText = String(document.getElementById('daily-message-text')?.textContent || '').trim();
    if (!selectedRun || !selectedRun.runId || !currentAdviceRunDate) {
        alert('No TCX or COROS FIT run selected. Run ANALYZER on a run day first.');
        return;
    }
    if (!visibleText) {
        alert('No run comment is available for this run yet.');
        return;
    }
    const btn = document.getElementById('refreshTcxAdviceBtn');
    const originalText = btn ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Applying...';
    }
    try {
        const res = await fetch('/api/daily', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: currentAdviceRunDate,
                message: visibleText
            })
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || `API ${res.status}`);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText || 'Apply';
        }
    }
}

function renderSummary(maxStride, maxTime, totalGap, maxHR, avgHR, maxCadence, avgCadence, maxSpeed, avgSpeed, totalSeconds, totalSteps, totalDistanceMeters, heartRateGuide = { maxText: '', avgText: '', avgSubText: '' }) {
    const gapSign = totalGap > 0 ? '-' : '+';
    const absGap = Math.abs(totalGap).toFixed(1);
    const estimatedMaxHeartRate = getEstimatedMaxHeartRate();
    const heartRatePercent = estimatedMaxHeartRate > 0 && Number(maxHR) > 0
        ? ` (${Math.round((Number(maxHR) / estimatedMaxHeartRate) * 100)}%)`
        : '';
    const maxGuideText = heartRateGuide.maxText || 'LTHR: -';
    const avgGuideText = heartRateGuide.avgText || 'LSD: -';
    const avgGuideSubText = heartRateGuide.avgSubText || 'Z2: -';
    const avgGuideCombinedText = [avgGuideText, avgGuideSubText].filter(text => String(text || '').trim() && String(text || '').trim() !== 'Z2: -').join('   ');
    const hh = Math.floor((Number(totalSeconds) || 0) / 3600);
    const mm = Math.floor(((Number(totalSeconds) || 0) % 3600) / 60);
    const ss = Math.floor((Number(totalSeconds) || 0) % 60);
    const totalTimeText = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    const distancePerStepText = Number(totalSteps) > 0
        ? ((Number(totalDistanceMeters) / Number(totalSteps)) * 100).toFixed(1)
        : '-';

    return `
        <div class="glass-card" style="display: grid; gap: 18px;">
            <div class="summary-grid">
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
                    <span class="stat-value" style="color: #ff4444;">${maxHR ? Math.round(maxHR) : '-'} bpm${heartRatePercent}</span>
                    <span class="stat-label heart-rate-guide-max" style="font-size: 0.75rem; margin-top: 4px;">${maxGuideText}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Avg Heart Rate</span>
                    <span class="stat-value" style="color: #ff9999;">${avgHR ? Math.round(avgHR) : '-'} bpm</span>
                    <span class="stat-label heart-rate-guide-avg" style="font-size: 0.75rem; margin-top: 4px;">${avgGuideCombinedText || avgGuideText}</span>
                    <span class="stat-label heart-rate-guide-avg-sub" style="display: none;"></span>
                </div>
                <div class="stat-item" style="border-left: 1px solid rgba(255,255,255,0.1);">
                    <span class="stat-label">Max Speed</span>
                    <span class="stat-value" style="color: #00f2ff;">${Number(maxSpeed) > 0 ? Number(maxSpeed).toFixed(1) : '-'} km/h</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Avg Speed</span>
                    <span class="stat-value" style="color: #7af0b8;">${Number(avgSpeed) > 0 ? Number(avgSpeed).toFixed(1) : '-'} km/h</span>
                </div>
                <div class="stat-item" style="border-left: 1px solid rgba(255,255,255,0.1);">
                    <span class="stat-label">Max Pitch</span>
                    <span class="stat-value" style="color: #ffd166;">${Number(maxCadence) > 0 ? Math.round(maxCadence) : '-'} spm</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Avg Pitch</span>
                    <span class="stat-value" style="color: #f4a261;">${Number(avgCadence) > 0 ? Math.round(avgCadence) : '-'} spm</span>
                </div>
            </div>
            <div class="summary-grid">
                <div class="stat-item">
                    <span class="stat-label">TIME</span>
                    <span class="stat-value" style="color: #9cc8ff;">${totalTimeText}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">STEPS</span>
                    <span class="stat-value" style="color: #ffffff;">${Math.round(totalSteps || 0).toLocaleString()}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">DIST (M)</span>
                    <span class="stat-value" style="color: #00f2ff;">${Number(totalDistanceMeters || 0).toFixed(1)}</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">DIST / STEPS x100</span>
                    <span class="stat-value" style="color: #7af0b8;">${distancePerStepText === '-' ? '-' : `${distancePerStepText}`}</span>
                </div>
            </div>
        </div>
    `;
}

// Chart Global Variable
let strideChartInstance = null;
let speedChartInstance = null;
let fitSpeedChartInstance = null;
let fitPitchChartInstance = null;
let fitStrideChartInstance = null;
let tcxStrideChartInstance = null;
let tcxSpeedPitchChartInstance = null;

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

function chartPointTimeToMillis(point) {
    if (Number.isFinite(Number(point && point.bucketStartMs))) {
        return Number(point.bucketStartMs);
    }
    if (Number.isFinite(Number(point && point.timestampMs))) {
        return Number(point.timestampMs);
    }
    return NaN;
}

function buildGapAwareChartData(data, gapMinutes = 2) {
    const gapMillis = gapMinutes * 60 * 1000;
    const expanded = [];
    data.forEach((point, index) => {
        if (index > 0) {
            const prevMillis = chartPointTimeToMillis(data[index - 1]);
            const currMillis = chartPointTimeToMillis(point);
            if (Number.isFinite(prevMillis) && Number.isFinite(currMillis) && (currMillis - prevMillis) > gapMillis) {
                expanded.push({
                    time: point.time,
                    bucketStartMs: Number.isFinite(currMillis) ? currMillis - 1 : null,
                    stride: null,
                    heartRate: null,
                    speed: null,
                    pitch: null,
                    steps: null
                });
            }
        }
        expanded.push({ ...point });
    });
    return expanded;
}

function speedFromIntradayDistance(point) {
    const distanceMeters = Number(point?.distance);
    if (!(distanceMeters > 0)) return null;

    const durationSeconds = Number(point?.distancePointDurationSeconds) > 0
        ? Number(point.distancePointDurationSeconds)
        : 60;

    return durationSeconds > 0
        ? Number(((distanceMeters / durationSeconds) * 3.6).toFixed(1))
        : null;
}

async function fetchDetailedFitSpeedSeries(date) {
    const res = await fetch(`/api/fit-speed?date=${encodeURIComponent(String(date || '').trim())}`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to fetch detailed fit speed data');
    }
    const payload = await res.json();
    return Array.isArray(payload?.chartData) ? payload.chartData : [];
}

async function fetchDetailedFitHeartRateSeries(date) {
    const res = await fetch(`/api/fit-hr?date=${encodeURIComponent(String(date || '').trim())}`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to fetch detailed fit heart rate data');
    }
    const payload = await res.json();
    return Array.isArray(payload?.chartData) ? payload.chartData : [];
}

async function fetchDetailedFitPitchSeries(date) {
    const res = await fetch(`/api/fit-pitch?date=${encodeURIComponent(String(date || '').trim())}`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to fetch detailed fit pitch data');
    }
    const payload = await res.json();
    return Array.isArray(payload?.chartData) ? payload.chartData : [];
}

async function fetchDetailedFitStrideSeries(date) {
    const res = await fetch(`/api/fit-stride?date=${encodeURIComponent(String(date || '').trim())}`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to fetch detailed fit stride data');
    }
    const payload = await res.json();
    return Array.isArray(payload?.chartData) ? payload.chartData : [];
}

async function fetchTcxRuns(date) {
    const res = await fetch(`/api/tcx-runs?date=${encodeURIComponent(String(date || '').trim())}`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to fetch TCX runs');
    }
    const payload = await res.json();
    return Array.isArray(payload?.runs) ? payload.runs : [];
}

async function fetchCorosFitRuns(date) {
    const res = await fetch(`/api/coros-fit-runs?date=${encodeURIComponent(String(date || '').trim())}`);
    if (!res.ok) throw new Error(await res.text() || 'Failed to fetch COROS FIT runs');
    const payload = await res.json();
    return Array.isArray(payload?.runs) ? payload.runs : [];
}

async function fetchCorosFitMinuteSeries(date, labelId) {
    const params = new URLSearchParams({ date: String(date || '').trim(), labelId: String(labelId || '').trim() });
    const res = await fetch(`/api/coros-fit-minute?${params.toString()}`);
    if (!res.ok) throw new Error(await res.text() || 'Failed to fetch COROS FIT minute data');
    return res.json();
}

async function fetchTcxMinuteSeries(date, runId = '') {
    const params = new URLSearchParams({ date: String(date || '').trim() });
    if (String(runId || '').trim()) params.set('runId', String(runId || '').trim());
    const res = await fetch(`/api/tcx-minute?${params.toString()}`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to fetch TCX minute data');
    }
    const payload = await res.json();
    return {
        chartData: Array.isArray(payload?.chartData) ? payload.chartData : [],
        altitudeDetail: Array.isArray(payload?.altitudeDetail) ? payload.altitudeDetail : []
    };
}

async function fetchTcxSplits(date, runId = '') {
    const params = new URLSearchParams({ date: String(date || '').trim() });
    if (String(runId || '').trim()) params.set('runId', String(runId || '').trim());
    const res = await fetch(`/api/tcx-splits?${params.toString()}`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || 'Failed to fetch TCX splits');
    }
    const payload = await res.json();
    return Array.isArray(payload?.chartData) ? payload.chartData : [];
}

function getTcxRowsTimeRange(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const numericStarts = rows
        .map((row) => Number(row?.bucketStartMs))
        .filter((value) => Number.isFinite(value));
    if (numericStarts.length === 0) return null;
    const startMs = Math.min(...numericStarts);
    const endMs = rows.reduce((max, row) => {
        const start = Number(row?.bucketStartMs);
        const coverageSeconds = Number(row?.coverageSeconds) > 0 ? Number(row.coverageSeconds) : 60;
        if (!Number.isFinite(start)) return max;
        return Math.max(max, start + (coverageSeconds * 1000));
    }, startMs);
    return { startMs, endMs };
}

function filterDetailedSeriesByRange(series = [], range = null) {
    if (!Array.isArray(series) || series.length === 0 || !range) return Array.isArray(series) ? series : [];
    const startMs = Number(range.startMs);
    const endMs = Number(range.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return Array.isArray(series) ? series : [];
    return series.filter((point) => {
        const ts = Number(point?.timestampMs);
        return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
    });
}

function formatChartTimeLabel(timestampMs, withSeconds = false) {
    const date = new Date(Number(timestampMs));
    if (!Number.isFinite(date.getTime())) return '';
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return withSeconds ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
}

function renderTcxMinuteTableRows(tbody, rows) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: var(--text-secondary);">No TCX minute data</td></tr>';
        return;
    }
    rows.forEach((row) => {
        const tr = document.createElement('tr');
        const adjusted = String(row?.distanceSource || '') === 'speed-adjusted';
        const deviationText = Number(row?.distanceDeviationRate) > 0 ? ` (${Number(row.distanceDeviationRate).toFixed(1)}%)` : '';
        const rawDistanceText = Number.isFinite(Number(row?.rawDistance)) ? Number(row.rawDistance).toFixed(1) : Number(row.distance || 0).toFixed(1);
        const rawSpeedText = Number.isFinite(Number(row?.rawSpeed)) ? Number(row.rawSpeed).toFixed(1) : Number(row.speed || 0).toFixed(1);
        tr.innerHTML = `
            <td>${row.time}</td>
            <td>${Number(row.distance || 0).toFixed(1)}${adjusted ? ` <span style="color:#f59e0b; font-size:11px; font-weight:600;">Adjusted (${rawDistanceText})</span>` : ''}</td>
            <td>${Number(row.stride) > 0 ? Number(row.stride).toFixed(1) : '-'}</td>
            <td style="color: #00f2ff; font-weight: bold;">${Number(row.speed) > 0 ? Number(row.speed).toFixed(1) : '-'}${adjusted ? ` <span style="color:#f59e0b; font-size:11px; font-weight:600;">Adjusted (${rawSpeedText})</span>` : ''}</td>
            <td style="color: #ff4444;">${Number(row.heartRate) > 0 ? Math.round(Number(row.heartRate)) : '-'}</td>
            <td style="color: #ffd166;">${Number(row.pitch) > 0 ? Math.round(Number(row.pitch)) : '-'}</td>
            <td>${Number.isFinite(Number(row.altitude)) ? Number(row.altitude).toFixed(1) : '-'}${adjusted ? `<div style="color:#f59e0b; font-size:11px;">Adjusted${deviationText} rawDist=${rawDistanceText} rawSpeed=${rawSpeedText}</div>` : ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderTcxLapTableRows(tbody, rows) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!Array.isArray(rows) || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">No TCX 1km splits</td></tr>';
        return;
    }
    rows.forEach((row) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.lapLabel || '-'}</td>
            <td>${row.distanceLabel || '-'}</td>
            <td>${Number(row.avgSpeed || 0).toFixed(1)}</td>
            <td>${Number(row.avgPitch || 0) > 0 ? Math.round(Number(row.avgPitch)) : '-'}</td>
            <td>${Number(row.avgHr || 0) > 0 ? Math.round(Number(row.avgHr)) : '-'}</td>
            <td>${Number(row.avgStride || 0).toFixed(1)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function clearFitSpeedChart() {
    if (fitSpeedChartInstance) {
        fitSpeedChartInstance.destroy();
        fitSpeedChartInstance = null;
    }
    const fitSpeedCanvas = document.getElementById('fitSpeedChart');
    if (fitSpeedCanvas) {
        const fitSpeedCtx = fitSpeedCanvas.getContext('2d');
        fitSpeedCtx.clearRect(0, 0, fitSpeedCtx.canvas.width, fitSpeedCtx.canvas.height);
    }
}

function clearFitPitchChart() {
    if (fitPitchChartInstance) {
        fitPitchChartInstance.destroy();
        fitPitchChartInstance = null;
    }
    const fitPitchCanvas = document.getElementById('fitPitchChart');
    if (fitPitchCanvas) {
        const fitPitchCtx = fitPitchCanvas.getContext('2d');
        fitPitchCtx.clearRect(0, 0, fitPitchCtx.canvas.width, fitPitchCtx.canvas.height);
    }
}

function clearFitStrideChart() {
    if (fitStrideChartInstance) {
        fitStrideChartInstance.destroy();
        fitStrideChartInstance = null;
    }
    const fitStrideCanvas = document.getElementById('fitStrideChart');
    if (fitStrideCanvas) {
        const fitStrideCtx = fitStrideCanvas.getContext('2d');
        fitStrideCtx.clearRect(0, 0, fitStrideCtx.canvas.width, fitStrideCtx.canvas.height);
    }
}

function clearTcxStrideChart() {
    if (tcxStrideChartInstance) {
        tcxStrideChartInstance.destroy();
        tcxStrideChartInstance = null;
    }
    const tcxStrideCanvas = document.getElementById('tcxStrideChart');
    if (tcxStrideCanvas) {
        const tcxStrideCtx = tcxStrideCanvas.getContext('2d');
        tcxStrideCtx.clearRect(0, 0, tcxStrideCtx.canvas.width, tcxStrideCtx.canvas.height);
    }
}

function clearTcxSpeedPitchChart() {
    if (tcxSpeedPitchChartInstance) {
        tcxSpeedPitchChartInstance.destroy();
        tcxSpeedPitchChartInstance = null;
    }
    const tcxSpeedPitchCanvas = document.getElementById('tcxSpeedPitchChart');
    if (tcxSpeedPitchCanvas) {
        const tcxSpeedPitchCtx = tcxSpeedPitchCanvas.getContext('2d');
        tcxSpeedPitchCtx.clearRect(0, 0, tcxSpeedPitchCtx.canvas.width, tcxSpeedPitchCtx.canvas.height);
    }
}

function buildChartHoverInteraction(mode = 'index') {
    return {
        mode,
        intersect: false,
        axis: 'x'
    };
}

function buildChartTooltipOptions(overrides = null, mode = 'index') {
    const tooltip = {
        mode,
        intersect: false
    };
    if (overrides && typeof overrides === 'object') {
        const callbackKeys = new Set([
            'beforeTitle',
            'title',
            'afterTitle',
            'beforeBody',
            'beforeLabel',
            'label',
            'labelColor',
            'labelTextColor',
            'afterLabel',
            'afterBody',
            'beforeFooter',
            'footer',
            'afterFooter'
        ]);
        const callbacks = {};
        for (const [key, value] of Object.entries(overrides)) {
            if (callbackKeys.has(key) && typeof value === 'function') {
                callbacks[key] = value;
            } else {
                tooltip[key] = value;
            }
        }
        if (Object.keys(callbacks).length > 0) {
            tooltip.callbacks = callbacks;
        }
    }
    return tooltip;
}

function buildUniqueSeriesTooltipLabeler(valueFormatter = null) {
    const seenLabels = new Set();
    return {
        reset() {
            seenLabels.clear();
        },
        label(context) {
            const label = String(context.dataset?.label || '').trim();
            if (!label) return null;
            if (seenLabels.has(label)) return null;
            seenLabels.add(label);
            const rawValue = context.parsed?.y ?? context.raw;
            const value = typeof valueFormatter === 'function'
                ? valueFormatter(rawValue, context)
                : rawValue;
            return `${label}: ${value}`;
        }
    };
}

function buildAltitudeBackgroundSeries(points = []) {
    const safePoints = Array.isArray(points) ? points : [];
    const altitudes = safePoints.map((point) => {
        const altitude = Number(point?.altitude);
        return Number.isFinite(altitude) ? altitude : null;
    });
    const valid = altitudes.filter((value) => Number.isFinite(value));
    if (valid.length === 0) {
        return safePoints.map(() => null);
    }
    const min = Math.min(...valid);
    const max = Math.max(...valid);
    if (!(max > min)) {
        return safePoints.map((point, index) => {
            const x = Number(point?.timestampMs);
            return Number.isFinite(altitudes[index]) && Number.isFinite(x)
                ? { x, y: 55 }
                : null;
        }).filter(Boolean);
    }
    return safePoints.map((point, index) => {
        const value = altitudes[index];
        const x = Number(point?.timestampMs);
        if (!Number.isFinite(value) || !Number.isFinite(x)) return null;
        const normalized = (value - min) / (max - min);
        return { x, y: Number((15 + (normalized * 80)).toFixed(2)) };
    }).filter(Boolean);
}

function renderTcxMinuteCharts(rows = [], altitudeDetail = []) {
    const tcxStrideCtx = document.getElementById('tcxStrideChart').getContext('2d');
    const tcxSpeedPitchCtx = document.getElementById('tcxSpeedPitchChart').getContext('2d');

    if (tcxStrideChartInstance) tcxStrideChartInstance.destroy();
    if (tcxSpeedPitchChartInstance) tcxSpeedPitchChartInstance.destroy();

    const chartData = Array.isArray(rows) ? rows.map((point) => ({ ...point })) : [];
    const stridePoints = chartData
        .filter((d) => Number.isFinite(Number(d.bucketStartMs)))
        .map((d) => ({ x: Number(d.bucketStartMs), y: Number(d.stride) > 0 ? Number(d.stride) : null }));
    const heartRatePoints = chartData
        .filter((d) => Number.isFinite(Number(d.bucketStartMs)))
        .map((d) => ({ x: Number(d.bucketStartMs), y: Number(d.heartRate) > 0 ? Number(d.heartRate) : null }));
    const speedPoints = chartData
        .filter((d) => Number.isFinite(Number(d.bucketStartMs)))
        .map((d) => ({ x: Number(d.bucketStartMs), y: Number(d.speed) > 0 ? Number(d.speed) : null }));
    const pitchPoints = chartData
        .filter((d) => Number.isFinite(Number(d.bucketStartMs)))
        .map((d) => ({ x: Number(d.bucketStartMs), y: Number(d.pitch) > 0 ? Number(d.pitch) : null }));
    const altitudeSource = Array.isArray(altitudeDetail) && altitudeDetail.length > 0
        ? altitudeDetail
        : chartData.map((point) => ({
            timestampMs: Number(point?.bucketStartMs),
            altitude: Number(point?.altitude)
        }));
    const altitudeBackground = buildAltitudeBackgroundSeries(altitudeSource);
    const chartRowByStartMs = new Map(chartData.map((row) => [Number(row?.bucketStartMs), row]));
    const xMin = chartData.length > 0 ? Math.min(...chartData.map((d) => Number(d.bucketStartMs || 0))) : undefined;
    const xMax = chartData.length > 0
        ? Math.max(...chartData.map((d) => {
            const start = Number(d.bucketStartMs || 0);
            const coverageSeconds = Number(d.coverageSeconds) > 0 ? Number(d.coverageSeconds) : 60;
            return start + (coverageSeconds * 1000);
        }))
        : undefined;
    const strideHrTooltip = buildUniqueSeriesTooltipLabeler((value) => Number.isFinite(Number(value)) ? Number(value) : '-');
    const speedPitchTooltip = buildUniqueSeriesTooltipLabeler((value) => Number.isFinite(Number(value)) ? Number(value) : '-');

    tcxStrideChartInstance = new Chart(tcxStrideCtx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Altitude',
                    data: altitudeBackground,
                    borderColor: 'rgba(192, 132, 252, 0.35)',
                    backgroundColor: 'rgba(192, 132, 252, 0.10)',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHitRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.25,
                    fill: 'origin',
                    yAxisID: 'y-altitude-bg'
                },
                {
                    label: 'Stride',
                    data: stridePoints,
                    borderColor: '#00f2ff',
                    backgroundColor: 'rgba(0, 242, 255, 0.05)',
                    borderWidth: 3,
                    pointRadius: 2,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0,
                    fill: true,
                    yAxisID: 'y-stride'
                },
                {
                    label: 'HR',
                    data: heartRatePoints,
                    borderColor: '#ff0055',
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointRadius: 0,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0,
                    fill: false,
                    yAxisID: 'y-heartrate'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: buildChartHoverInteraction('x'),
            scales: {
                x: {
                    type: 'linear',
                    min: Number.isFinite(xMin) ? xMin : undefined,
                    max: Number.isFinite(xMax) ? xMax : undefined,
                    grid: { color: '#444' },
                    ticks: {
                        color: '#eee',
                        callback: (value) => formatChartTimeLabel(Number(value), false)
                    }
                },
                'y-altitude-bg': {
                    type: 'linear',
                    display: false,
                    min: 0,
                    max: 100
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
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#ff0055' },
                    beginAtZero: false
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#eee',
                        filter: (item) => item.text !== 'Altitude'
                    }
                },
                tooltip: buildChartTooltipOptions({
                    filter: (ctx) => ctx.dataset?.yAxisID !== 'y-altitude-bg',
                    title: (items) => {
                        strideHrTooltip.reset();
                        const first = Array.isArray(items) ? items[0] : null;
                        return first ? formatChartTimeLabel(Number(first.parsed?.x), true) : '';
                    },
                    label: (context) => strideHrTooltip.label(context),
                    afterBody: (items) => {
                        const first = Array.isArray(items) ? items[0] : null;
                        const row = first ? chartRowByStartMs.get(Number(first.parsed?.x)) : null;
                        if (String(row?.distanceSource || '') !== 'speed-adjusted') return [];
                        return [`Adjusted (${Number(row?.distanceDeviationRate || 0).toFixed(1)}%) rawDist=${Number(row?.rawDistance || row?.distance || 0).toFixed(1)}m rawSpeed=${Number(row?.rawSpeed || row?.speed || 0).toFixed(1)}`];
                    }
                }, 'x')
            }
        }
    });

    tcxSpeedPitchChartInstance = new Chart(tcxSpeedPitchCtx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Altitude',
                    data: altitudeBackground,
                    borderColor: 'rgba(192, 132, 252, 0.35)',
                    backgroundColor: 'rgba(192, 132, 252, 0.10)',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHitRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.25,
                    fill: 'origin',
                    yAxisID: 'y-altitude-bg'
                },
                {
                    label: 'Speed',
                    data: speedPoints,
                    borderColor: '#7af0b8',
                    backgroundColor: 'rgba(122, 240, 184, 0.08)',
                    borderWidth: 3,
                    pointRadius: 2,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0,
                    fill: true,
                    yAxisID: 'y-speed'
                },
                {
                    label: 'Pitch',
                    data: pitchPoints,
                    borderColor: '#ffd166',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0,
                    fill: false,
                    yAxisID: 'y-pitch'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: buildChartHoverInteraction('x'),
            scales: {
                x: {
                    type: 'linear',
                    min: Number.isFinite(xMin) ? xMin : undefined,
                    max: Number.isFinite(xMax) ? xMax : undefined,
                    grid: { color: '#444' },
                    ticks: {
                        color: '#eee',
                        callback: (value) => formatChartTimeLabel(Number(value), false)
                    }
                },
                'y-altitude-bg': {
                    type: 'linear',
                    display: false,
                    min: 0,
                    max: 100
                },
                'y-speed': {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Speed (km/h)',
                        color: '#7af0b8'
                    },
                    grid: { color: '#444' },
                    ticks: { color: '#7af0b8' },
                    beginAtZero: false
                },
                'y-pitch': {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Pitch (spm)',
                        color: '#ffd166'
                    },
                    grid: { drawOnChartArea: false },
                    ticks: { color: '#ffd166' },
                    beginAtZero: false
                }
            },
            plugins: {
                legend: {
                    labels: {
                        color: '#eee',
                        filter: (item) => item.text !== 'Altitude'
                    }
                },
                tooltip: buildChartTooltipOptions({
                    filter: (ctx) => ctx.dataset?.yAxisID !== 'y-altitude-bg',
                    title: (items) => {
                        speedPitchTooltip.reset();
                        const first = Array.isArray(items) ? items[0] : null;
                        return first ? formatChartTimeLabel(Number(first.parsed?.x), true) : '';
                    },
                    label: (context) => speedPitchTooltip.label(context),
                    afterBody: (items) => {
                        const first = Array.isArray(items) ? items[0] : null;
                        const row = first ? chartRowByStartMs.get(Number(first.parsed?.x)) : null;
                        if (String(row?.distanceSource || '') !== 'speed-adjusted') return [];
                        return [`Adjusted (${Number(row?.distanceDeviationRate || 0).toFixed(1)}%) rawDist=${Number(row?.rawDistance || row?.distance || 0).toFixed(1)}m rawSpeed=${Number(row?.rawSpeed || row?.speed || 0).toFixed(1)}`];
                    }
                }, 'x')
            }
        }
    });
}

function setLegacyChartVisibility(hasTcxRunData, hasCorosFitRunData = false) {
    const display = (id, visible) => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = visible ? '' : 'none';
        }
    };

    if (hasTcxRunData || hasCorosFitRunData) {
        display('lapSplitsWrapper', !hasTcxRunData);
        display('tcxLapSplitsWrapper', hasTcxRunData);
        display('legacyStrideChartWrapper', false);
        display('legacySpeedChartWrapper', false);
        display('fitSpeedChartWrapper', true);
        display('fitPitchChartWrapper', false);
        display('fitStrideChartWrapper', false);
        display('tcxStrideChartWrapper', true);
        display('tcxSpeedPitchChartWrapper', true);
        display('legacyPerMinuteWrapper', false);
        display('tcxPerMinuteWrapper', true);
        return;
    }

    display('lapSplitsWrapper', true);
    display('tcxLapSplitsWrapper', false);
    display('legacyStrideChartWrapper', true);
    display('legacySpeedChartWrapper', true);
    display('fitSpeedChartWrapper', true);
    display('fitPitchChartWrapper', false);
    display('fitStrideChartWrapper', false);
    display('tcxStrideChartWrapper', false);
    display('tcxSpeedPitchChartWrapper', false);
    display('legacyPerMinuteWrapper', false);
    display('tcxPerMinuteWrapper', true);
}

function setFitDetailChartAvailability(availability = {}) {
    const display = (id, visible) => {
        const element = document.getElementById(id);
        if (element) element.style.display = visible ? '' : 'none';
    };
    display('fitSpeedChartWrapper', Boolean(availability.speed));
    display('fitPitchChartWrapper', false);
    display('fitStrideChartWrapper', false);
}

function renderDetailedFitSpeedChart(speedSeries, heartRateSeries = []) {
    const fitSpeedCtx = document.getElementById('fitSpeedChart').getContext('2d');
    if (fitSpeedChartInstance) {
        fitSpeedChartInstance.destroy();
    }

    const hrMap = new Map(
        (Array.isArray(heartRateSeries) ? heartRateSeries : [])
            .filter((point) => Number.isFinite(Number(point?.timestampMs)))
            .map((point) => [Number(point.timestampMs), Number(point.heartRate) > 0 ? Number(point.heartRate) : null])
    );
    const labels = speedSeries.map((point) => {
        const raw = String(point?.time || '');
        return raw.length >= 5 ? raw.slice(0, 5) : raw;
    });
    const speeds = speedSeries.map((point) => Number(point.speedKmh) > 0 ? Number(point.speedKmh) : null);
    const heartRates = speedSeries.map((point) => {
        const ts = Number(point?.timestampMs);
        return Number.isFinite(ts) && hrMap.has(ts) ? hrMap.get(ts) : null;
    });
    function formatDetailedSeriesValue(value) {
        return Number.isFinite(Number(value)) ? String(value) : '-';
    }

    fitSpeedChartInstance = new Chart(fitSpeedCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Speed (accurate)',
                    data: speeds,
                    borderColor: '#8cb4ff',
                    backgroundColor: 'rgba(140, 180, 255, 0.12)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0,
                    fill: true,
                    yAxisID: 'y-fit-speed'
                },
                {
                    label: 'HR (accurate)',
                    data: heartRates,
                    borderColor: '#ff7aa8',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0,
                    fill: false,
                    yAxisID: 'y-fit-hr'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: buildChartHoverInteraction(),
            scales: {
                x: {
                    grid: { color: '#444' },
                    ticks: {
                        color: '#eee',
                        autoSkip: true,
                        maxTicksLimit: 12,
                        minRotation: 50,
                        maxRotation: 50
                    }
                },
                'y-fit-speed': {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Speed',
                        color: '#8cb4ff'
                    },
                    grid: { color: '#444' },
                    ticks: { color: '#8cb4ff' },
                    beginAtZero: false
                },
                'y-fit-hr': {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'HR',
                        color: '#ff7aa8'
                    },
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: { color: '#ff7aa8' },
                    beginAtZero: false
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#eee' }
                },
                tooltip: buildChartTooltipOptions({
                    label(context) {
                        const label = context.dataset?.label || '';
                        const value = context.raw;
                        return `${label}: ${formatDetailedSeriesValue(value)}`;
                    }
                })
            }
        }
    });
}

function renderDetailedFitPitchChart(pitchSeries = []) {
    const fitPitchCtx = document.getElementById('fitPitchChart').getContext('2d');
    if (fitPitchChartInstance) {
        fitPitchChartInstance.destroy();
    }

    const labels = pitchSeries.map((point) => {
        const raw = String(point?.time || '');
        return raw.length >= 5 ? raw.slice(0, 5) : raw;
    });
    const pitches = pitchSeries.map((point) => Number.isFinite(Number(point?.pitchSpm)) ? Number(point.pitchSpm) : null);

    fitPitchChartInstance = new Chart(fitPitchCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Pitch (rough)',
                    data: pitches,
                    borderColor: '#ffd166',
                    backgroundColor: 'rgba(255, 209, 102, 0.10)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    stepped: true,
                    tension: 0,
                    fill: true,
                    yAxisID: 'y-fit-pitch'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: buildChartHoverInteraction(),
            plugins: {
                legend: {
                    labels: { color: '#eee' }
                },
                tooltip: buildChartTooltipOptions({
                    label(context) {
                        const label = context.dataset?.label || '';
                        const value = Number.isFinite(Number(context.raw)) ? String(context.raw) : '-';
                        return `${label}: ${value}`;
                    }
                })
            },
            scales: {
                x: {
                    grid: { color: '#444' },
                    ticks: {
                        color: '#eee',
                        autoSkip: true,
                        maxTicksLimit: 12,
                        minRotation: 50,
                        maxRotation: 50
                    }
                },
                'y-fit-pitch': {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    afterFit(scale) {
                        scale.width = 72;
                    },
                    title: {
                        display: true,
                        text: 'Pitch (spm)',
                        color: '#ffd166'
                    },
                    grid: { color: '#444' },
                    ticks: { color: '#ffd166' },
                    beginAtZero: false
                },
                'y-fit-pitch-spacer': {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    afterFit(scale) {
                        scale.width = 72;
                    },
                    min: 0,
                    max: 1,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        display: true,
                        color: 'rgba(0,0,0,0)',
                        padding: 12,
                        callback: () => ''
                    },
                    title: {
                        display: true,
                        text: 'HR',
                        color: 'rgba(0,0,0,0)'
                    }
                }
            }
        }
    });
}

function renderDetailedFitStrideChart(strideSeries = []) {
    const fitStrideCtx = document.getElementById('fitStrideChart').getContext('2d');
    if (fitStrideChartInstance) {
        fitStrideChartInstance.destroy();
    }

    const labels = strideSeries.map((point) => {
        const raw = String(point?.time || '');
        return raw.length >= 5 ? raw.slice(0, 5) : raw;
    });
    const strides = strideSeries.map((point) => Number.isFinite(Number(point?.strideCm)) ? Number(point.strideCm) : null);

    fitStrideChartInstance = new Chart(fitStrideCtx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Stride (rough)',
                    data: strides,
                    borderColor: '#00f2ff',
                    backgroundColor: 'rgba(0, 242, 255, 0.10)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    stepped: true,
                    tension: 0,
                    fill: true,
                    yAxisID: 'y-fit-stride'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: buildChartHoverInteraction(),
            plugins: {
                legend: {
                    labels: { color: '#eee' }
                },
                tooltip: buildChartTooltipOptions({
                    label(context) {
                        const label = context.dataset?.label || '';
                        const value = Number.isFinite(Number(context.raw)) ? String(context.raw) : '-';
                        return `${label}: ${value}`;
                    }
                })
            },
            scales: {
                x: {
                    grid: { color: '#444' },
                    ticks: {
                        color: '#eee',
                        autoSkip: true,
                        maxTicksLimit: 12,
                        minRotation: 50,
                        maxRotation: 50
                    }
                },
                'y-fit-stride': {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    afterFit(scale) {
                        scale.width = 72;
                    },
                    title: {
                        display: true,
                        text: 'Stride (cm)',
                        color: '#00f2ff'
                    },
                    grid: { color: '#444' },
                    ticks: { color: '#00f2ff' },
                    beginAtZero: false
                },
                'y-fit-stride-spacer': {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    afterFit(scale) {
                        scale.width = 72;
                    },
                    min: 0,
                    max: 1,
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: {
                        display: true,
                        color: 'rgba(0,0,0,0)',
                        padding: 12,
                        callback: () => ''
                    },
                    title: {
                        display: true,
                        text: 'HR',
                        color: 'rgba(0,0,0,0)'
                    }
                }
            }
        }
    });
}

function renderChart(data) {
    const strideCtx = document.getElementById('strideChart').getContext('2d');
    const speedCtx = document.getElementById('speedChart').getContext('2d');

    // Destroy existing chart to prevent overlap
    if (strideChartInstance) {
        strideChartInstance.destroy();
    }
    if (speedChartInstance) {
        speedChartInstance.destroy();
    }

    const chartData = Array.isArray(data) ? data.map((point) => ({ ...point })) : [];
    const times = chartData.map(d => d.time);
    const strides = chartData.map(d => Number.isFinite(Number(d.stride)) ? d.stride : null);
    const smaStrides = strides;
    const speeds = chartData.map((d) => Number(d?.speed) > 0 ? Number(d.speed) : null);
    const pitches = chartData.map(d => Number(d.pitch) > 0 ? Number(d.pitch) : (Number(d.steps) > 0 ? Number(d.steps) : null));

    const heartRatesRaw = chartData.map(d => d.heartRate || 0);
    const heartRatesSMA = heartRatesRaw.map(v => v > 0 ? v : null);

    strideChartInstance = new Chart(strideCtx, {
        type: 'line',
        data: {
            labels: times,
            datasets: [
                // --- STRIDE ---
                {
                    label: 'Stride',
                    data: smaStrides,
                    borderColor: '#00f2ff', // Cyan (Main)
                    backgroundColor: 'rgba(0, 242, 255, 0.05)',
                    borderWidth: 3,
                    pointRadius: 2, // Slight radius for visibility
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y-stride',
                    order: 1
                },
                // --- HEART RATE ---
                {
                    label: 'HR',
                    data: heartRatesSMA,
                    borderColor: '#ff0055', // Bold Red
                    backgroundColor: 'transparent',
                    borderWidth: 3,
                    pointRadius: 0,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
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
            interaction: buildChartHoverInteraction(),
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
                tooltip: buildChartTooltipOptions()
            }
        }
    });

    speedChartInstance = new Chart(speedCtx, {
        type: 'line',
        data: {
            labels: times,
            datasets: [
                {
                    label: 'Speed',
                    data: speeds,
                    borderColor: '#7af0b8',
                    backgroundColor: 'rgba(122, 240, 184, 0.08)',
                    borderWidth: 3,
                    pointRadius: 2,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0.4,
                    fill: true,
                    yAxisID: 'y-speed'
                },
                {
                    label: 'Pitch',
                    data: pitches,
                    borderColor: '#ffd166',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHitRadius: 12,
                    pointHoverRadius: 4,
                    tension: 0.35,
                    fill: false,
                    yAxisID: 'y-pitch'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: buildChartHoverInteraction(),
            scales: {
                x: {
                    grid: { color: '#444' },
                    ticks: { color: '#eee' }
                },
                'y-speed': {
                    type: 'linear',
                    display: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Speed (km/h)',
                        color: '#7af0b8'
                    },
                    grid: { color: '#444' },
                    ticks: { color: '#7af0b8' },
                    beginAtZero: false
                },
                'y-pitch': {
                    type: 'linear',
                    display: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Pitch (spm)',
                        color: '#ffd166'
                    },
                    grid: {
                        drawOnChartArea: false
                    },
                    ticks: { color: '#ffd166' },
                    beginAtZero: false
                }
            },
            plugins: {
                legend: {
                    labels: { color: '#eee' }
                },
                tooltip: buildChartTooltipOptions()
            }
        }
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    restoreHeightInput();
    restoreAgeInput();
    restoreRestingHrInput();
    restoreRunDateInput();
    restoreSnapshotDateInput();
    restoreFitSyncFromDateInput();
    restoreAdviceToggles();
    renderHeartRateGuide();
    bindAdviceToggles();

    loadData({ triggerAdvice: false });
    updateDebugHints();

    document.getElementById('analyzeBtn').addEventListener('click', () => {
        loadData({ triggerAdvice: true });
    });
    document.getElementById('syncJsonBtn')?.addEventListener('click', syncFitJsonRangeFromUi);
    document.getElementById('copySplitsJsonBtn')?.addEventListener('click', async () => {
        try {
            await copyLapSplitsAsJson();
        } catch (err) {
            alert(`Failed to copy JSON: ${err.message}`);
        }
    });
    document.getElementById('copySplitsMdBtn')?.addEventListener('click', async () => {
        try {
            await copyLapSplitsAsMarkdown();
        } catch (err) {
            alert(`Failed to copy MD: ${err.message}`);
        }
    });
    document.getElementById('copyTcxJsonBtn')?.addEventListener('click', async () => {
        try {
            await copyTcxMinuteAsJson();
        } catch (err) {
            alert(`Failed to copy JSON: ${err.message}`);
        }
    });
    document.getElementById('copyTcxMdBtn')?.addEventListener('click', async () => {
        try {
            await copyTcxMinuteAsMarkdown();
        } catch (err) {
            alert(`Failed to copy MD: ${err.message}`);
        }
    });
    document.getElementById('copyTcxChartsBtn')?.addEventListener('click', async () => {
        try {
            await copyVisibleTcxChartsAsImage();
        } catch (err) {
            alert(`Failed to copy charts: ${err.message}`);
        }
    });
    document.getElementById('refreshTcxAdviceBtn')?.addEventListener('click', async () => {
        try {
            await applySelectedRunAdviceFromCurrentView();
        } catch (err) {
            alert(`Failed to apply run comment: ${err.message}`);
        }
    });
    document.getElementById('tcxRunPrevBtn')?.addEventListener('click', () => {
        changeTcxRunPage(-1);
    });
    document.getElementById('tcxRunNextBtn')?.addEventListener('click', () => {
        changeTcxRunPage(1);
    });
    document.getElementById('corosFitSourceBtn')?.addEventListener('click', () => {
        setRunChartSource('coros_fit');
    });
    document.getElementById('tcxSourceBtn')?.addEventListener('click', () => {
        setRunChartSource('tcx');
    });
    document.getElementById('runBatchBtn')?.addEventListener('click', runBatchFromScreen);
    document.getElementById('batchLoadImagesBtn')?.addEventListener('click', handleBatchLoadImages);
    document.getElementById('imageImportBtn')?.addEventListener('click', runImageImportFlow);
    document.getElementById('clearDebugBtn')?.addEventListener('click', clearDebugTarget);
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
    document.getElementById('saveAgeBtn')?.addEventListener('click', saveAgeInput);
    document.getElementById('saveRestHrBtn')?.addEventListener('click', saveRestingHrInput);
    // Modal Event Listeners
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('inboxModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('inboxModal')) closeModal();
    });
    document.querySelectorAll('input[name="pickerMode"]').forEach((input) => {
        input.addEventListener('change', async (e) => {
            currentPickerMode = e.target && e.target.value === 'tcx' ? 'tcx' : 'image';
            if (currentRunDate) {
                await renderInboxModalContents();
            }
        });
    });
    document.getElementById('closeClipboardModalBtn')?.addEventListener('click', closeClipboardModal);
    document.getElementById('clipboardModal')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('clipboardModal')) closeClipboardModal();
    });
    document.getElementById('importBtn').addEventListener('click', importSelectedImages);

    // Initial History Load
    loadRunHistory();
    setBatchPickerMessage('No images loaded yet. Press SYNC DAILY after confirming dates.');
    renderBatchIdleState('Ready. Press SYNC DAILY to import/sync.');
    const clearDateInput = document.getElementById('clearDateInput');
    const snapshotInput = document.getElementById('snapshotDateInput');
    if (clearDateInput && snapshotInput && !String(clearDateInput.value || '').trim()) {
        clearDateInput.value = String(snapshotInput.value || '').trim();
    }
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
    const btn = document.getElementById('openPickerBtn');
    if (!btn) return;
    const normalizedDate = String(date || '').trim();
    btn.disabled = !normalizedDate;
    btn.onclick = normalizedDate ? () => openInboxModal(normalizedDate) : null;
}

async function checkAndRenderImages(date) {
    const summarySection = document.getElementById('summary');
    if (!summarySection) return;

    // Remove existing image container if any
    const existingContainer = document.querySelector('.run-images-container');
    if (existingContainer) existingContainer.remove();
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
let currentPickerMode = 'tcx';

async function openInboxModal(date) {
    currentRunDate = date;
    const modal = document.getElementById('inboxModal');
    const importBtn = document.getElementById('importBtn');

    modal.style.display = 'flex';
    selectedFiles.clear();
    importBtn.disabled = true;
    importBtn.textContent = 'Import Selected';
    currentPickerMode = document.querySelector('input[name="pickerMode"]:checked')?.value === 'tcx' ? 'tcx' : 'image';
    await renderInboxModalContents();
}

async function loadImageInboxItems() {
    const grid = document.getElementById('inboxGrid');
    if (!grid) return;
    grid.className = 'inbox-grid';
    grid.innerHTML = '<div style="color:#888; text-align:center; width:100%;">Loading Mobile Devices...</div>';
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
            grid.innerHTML = '<div style="color:#888; text-align:center; width:100%;">Mobile Devices folder is empty</div>';
            return;
        }

        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'inbox-item';
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

async function loadTcxInboxItems() {
    const grid = document.getElementById('inboxGrid');
    if (!grid) return;
    grid.className = '';
    grid.innerHTML = '<div style="color:#888; text-align:center; width:100%;">Loading TCX files...</div>';
    try {
        const res = await fetch('/api/inbox/tcx-files');
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        const files = await res.json();
        const tcxFiles = Array.isArray(files) ? files : [];
        grid.innerHTML = '';

        if (tcxFiles.length === 0) {
            grid.innerHTML = '<div style="color:#888; text-align:center; width:100%;">No TCX files found in Mobile Devices</div>';
            return;
        }

        tcxFiles.forEach(file => {
            const filename = String(file?.filename || '').trim();
            const fileDate = String(file?.date || '').trim();
            const item = document.createElement('div');
            item.className = 'glass-card';
            item.style.cursor = 'pointer';
            item.style.padding = '12px 14px';
            item.style.marginBottom = '8px';
            item.innerHTML = `
                <div style="font-weight:600; color: var(--text-primary); word-break: break-all;">${filename}</div>
                <div style="margin-top:6px; color: var(--text-secondary); font-size:0.85rem;">
                    Date: ${fileDate || '-'}${file?.startTimeLabel ? ` / Start: ${String(file.startTimeLabel)}` : ''}
                </div>
            `;
            item.onclick = () => toggleSelection(item, filename);
            grid.appendChild(item);
        });
    } catch (err) {
        console.error(err);
        grid.innerHTML = '<div style="color:red; text-align:center;">Failed to load TCX files</div>';
    }
}

async function renderInboxModalContents() {
    const importBtn = document.getElementById('importBtn');
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.textContent = currentPickerMode === 'tcx' ? 'Import Selected TCX' : 'Import Selected';
    }
    selectedFiles.clear();
    if (currentPickerMode === 'tcx') {
        await loadTcxInboxItems();
        return;
    }
    await loadImageInboxItems();
}

function closeModal() {
    document.getElementById('inboxModal').style.display = 'none';
    currentRunDate = null;
    selectedFiles.clear();
    currentPickerMode = 'tcx';
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
    if (currentPickerMode === 'tcx') {
        btn.textContent = selectedFiles.size > 0 ? `Import ${selectedFiles.size} TCX file(s)` : 'Import Selected TCX';
    } else {
        btn.textContent = selectedFiles.size > 0 ? `Import ${selectedFiles.size} Image(s)` : 'Import Selected';
    }
}

async function importSelectedImages() {
    if (selectedFiles.size === 0) return;
    if (currentPickerMode !== 'tcx' && !currentRunDate) return;

    const btn = document.getElementById('importBtn');
    const originalText = btn.textContent;
    if (currentPickerMode === 'tcx') {
        btn.textContent = 'Importing TCX...';
        btn.disabled = true;
        try {
            const res = await fetch('/api/tcx/import-selected', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filenames: Array.from(selectedFiles),
                    adviceProvider: getSelectedAdviceProvider()
                })
            });
            const payload = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(payload?.error ? String(payload.error) : 'TCX import failed');
            }

            const importedDates = Array.isArray(payload?.results)
                ? payload.results
                    .map((row) => normalizeRunDate(row?.data?.date || ''))
                    .filter((date, index, array) => date && array.indexOf(date) === index)
                : [];
            const dateToRefresh = importedDates[0] || currentRunDate || '';
            if (dateToRefresh) {
                const dateInput = document.getElementById('dateInput');
                if (dateInput) dateInput.value = dateToRefresh;
                persistRunDateInput();
            }
            closeModal();
            await loadData({ triggerAdvice: false });
            await loadRunHistory();
            if (dateToRefresh) {
                checkAndRenderImages(dateToRefresh);
            }
            alert(`Imported ${Number(payload?.success_count || 0)} TCX file(s).`);
        } catch (err) {
            console.error(err);
            alert(err instanceof Error ? err.message : 'TCX import failed');
        } finally {
            btn.textContent = originalText;
            btn.disabled = false;
        }
        return;
    }

    const selectedMode = document.querySelector('input[name="batchOcrMode"]:checked');
    const ocrMode = selectedMode ? String(selectedMode.value || 'python').trim() : 'python';
    btn.textContent = 'Importing...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/images/import-auto-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filenames: Array.from(selectedFiles),
                ocr_mode: ocrMode
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

        const successCount = Number(payload?.success_count || 0);
        const failedCount = Number(payload?.failed_count || 0);
        const resolvedDates = Array.from(new Set(
            (Array.isArray(payload?.results) ? payload.results : [])
                .filter((row) => row && row.status === 'success' && row.resolved_date)
                .map((row) => String(row.resolved_date))
        ));

        const dateToRefresh = currentRunDate; // Capture before clearing
        closeModal();
        // Refresh images area
        await loadData({ triggerAdvice: false });
        await loadRunHistory();
        checkAndRenderImages(dateToRefresh);
        alert(`Imported ${successCount} image(s). Failed: ${failedCount}.${resolvedDates.length > 0 ? `\nLinked dates: ${resolvedDates.join(', ')}` : ''}`);

    } catch (err) {
        console.error(err);
        btn.textContent = 'Error!';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.disabled = false;
        }, 2000);
    }
}

async function clearDebugTarget() {
    const clearDateInput = document.getElementById('clearDateInput');
    const targetDate = clearDateInput ? normalizeRunDate(clearDateInput.value) : '';
    if (!targetDate) {
        alert('Clear date is required.');
        return;
    }

    const mode = getSelectedClearMode();
    const btn = document.getElementById('clearDebugBtn');
    const originalText = btn ? btn.textContent : '';
    const actionLabel =
        mode === 'fit_json'
            ? 'FIT JSON cache'
            : mode === 'image_reset'
                ? 'images and OCR data'
                : 'daily data';
    const confirmed = window.confirm(`Clear ${actionLabel} for ${targetDate}?`);
    if (!confirmed) return;

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'CLEARING...';
    }

    try {
        let res;
        if (mode === 'fit_json') {
            res = await fetch(`/api/debug/cache/${encodeURIComponent(targetDate)}`, {
                method: 'DELETE'
            });
        } else if (mode === 'image_reset') {
            res = await fetch(`/api/runs/${encodeURIComponent(targetDate)}?mode=image_reset`, {
                method: 'DELETE'
            });
        } else {
            res = await fetch(`/api/runs/${encodeURIComponent(targetDate)}?mode=summary_only`, {
                method: 'DELETE'
            });
        }
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(payload?.error ? String(payload.error) : `Clear failed: ${res.status}`);
        }

        await loadData({ triggerAdvice: false });
        await loadRunHistory();
        checkAndRenderImages(targetDate);
        alert(`Cleared ${actionLabel} for ${targetDate}.`);
    } catch (err) {
        console.error(err);
        alert(err instanceof Error ? err.message : 'Clear failed');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText || 'CLEAR RUN';
        }
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
        const selectedRun = getSelectedActiveRun();
        if (selectedRun) {
            const runMessage = await loadRunMessage(date, selectedRun.runId);
            if (runMessage) {
                textSpan.textContent = runMessage;
                container.style.display = 'block';
            } else {
                container.style.display = 'none';
            }
            return;
        }
        const res = await fetch(`/api/daily/${date}`);
        if (!res.ok) {
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
    const targetDate = manualFrom || (dateInput ? normalizeRunDate(dateInput.value) : '');
    if (!targetDate) {
        alert('Daily sync date is required.');
        return;
    }
    markDebugAnchorDate(targetDate);
    const dates = [targetDate];
    const pendingState = getSinglePendingState(IMAGE_IMPORT_CHECKPOINT_DATE_STORAGE_KEY, targetDate);
    if (pendingState.pendingCount === 0) {
        const shouldContinue = confirm(`${targetDate} is not pending. Run SYNC DAILY for this date again?`);
        if (!shouldContinue) {
            updateDebugHints();
            return;
        }
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

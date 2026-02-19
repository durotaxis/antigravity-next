const WR_STRIDE = 200.0;
const GEMINI_TOGGLE_STORAGE_KEY = 'useGeminiApi';
const batchSelectedFiles = new Set();
let latestBatchRunToken = 0;

function isGeminiEnabled() {
    const toggle = document.getElementById('geminiToggle');
    return !!(toggle && toggle.checked);
}

function restoreGeminiToggle() {
    const toggle = document.getElementById('geminiToggle');
    if (!toggle) return;

    const saved = localStorage.getItem(GEMINI_TOGGLE_STORAGE_KEY);
    if (saved === null) {
        toggle.checked = true;
        return;
    }

    toggle.checked = saved === '1';
}

function bindGeminiToggle() {
    const toggle = document.getElementById('geminiToggle');
    if (!toggle) return;

    toggle.addEventListener('change', () => {
        localStorage.setItem(GEMINI_TOGGLE_STORAGE_KEY, toggle.checked ? '1' : '0');
    });
}

function escapeHtml(text) {
    return String(text || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function setBatchPickerMessage(message) {
    const picker = document.getElementById('batchImagePicker');
    if (!picker) return;
    picker.textContent = message;
}

function renderBatchImagePicker(images) {
    const picker = document.getElementById('batchImagePicker');
    if (!picker) return;

    picker.innerHTML = '';
    if (!Array.isArray(images) || images.length === 0) {
        batchSelectedFiles.clear();
        setBatchPickerMessage('No linked images for this date. Add manual filename or link image first.');
        return;
    }

    const known = new Set(images.map(i => String(i.stored_filename || '').trim()).filter(Boolean));
    Array.from(batchSelectedFiles).forEach(name => {
        if (!known.has(name)) batchSelectedFiles.delete(name);
    });

    images.forEach((img) => {
        const filename = String(img && img.stored_filename ? img.stored_filename : '').trim();
        if (!filename) return;
        if (!batchSelectedFiles.has(filename)) batchSelectedFiles.add(filename);

        const row = document.createElement('label');
        row.className = 'batch-image-item';
        row.innerHTML = `
            <input type="checkbox" ${batchSelectedFiles.has(filename) ? 'checked' : ''}>
            <span>${escapeHtml(filename)}</span>
        `;
        const checkbox = row.querySelector('input');
        checkbox?.addEventListener('change', () => {
            if (checkbox.checked) batchSelectedFiles.add(filename);
            else batchSelectedFiles.delete(filename);
        });
        picker.appendChild(row);
    });
}

async function loadBatchImageCandidates() {
    const dateInput = document.getElementById('dateInput');
    const date = dateInput ? String(dateInput.value || '').trim() : '';
    if (!date) {
        setBatchPickerMessage('Date is required.');
        return;
    }

    setBatchPickerMessage('Loading images...');
    try {
        const res = await fetch(`/api/images/candidates?date=${encodeURIComponent(date)}`);
        if (!res.ok) throw new Error(`Failed to load images: ${res.status}`);
        const images = await res.json();
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
    const date = dateInput ? String(dateInput.value || '').trim() : '';
    if (!date) {
        setBatchPickerMessage('Date is required.');
        return { imported: 0, matched: 0 };
    }

    const targetToken = normalizeDigitsOnly(date);
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

    const importRes = await fetch(`/api/runs/${encodeURIComponent(date)}/import-selected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filenames: matchedFiles,
            skipAdvice: !isGeminiEnabled()
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
    try {
        setBatchPickerMessage('Importing from Phone Link...');
        const imported = await importInboxImagesForBatchDate();
        await loadBatchImageCandidates();
        renderBatchResult({
            mode: 'batch-load',
            imported_from_inbox: imported.imported,
            matched_inbox_files: imported.matched
        });
    } catch (err) {
        setBatchPickerMessage(`Batch load error: ${err.message}`);
    }
}

async function loadData() {
    const dateInput = document.getElementById('dateInput');
    const date = dateInput.value;
    const summaryContainer = document.getElementById('summary');
    const tbody = document.querySelector('#resultTable tbody');
    const analyzeBtn = document.getElementById('analyzeBtn');

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'ANALYZING...';
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--text-secondary);">Loading data...</td></tr>';

    // Clear message first
    document.getElementById('daily-message-container').style.display = 'none';
    document.getElementById('daily-message-text').textContent = '';

    try {
        const res = await fetch(`/api/stride?date=${date}`);
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

        // --- Call AI Advice ---
        if (isGeminiEnabled()) {
            getAdvice(date, maxStride, data);
            loadDailyMessage(date);
        } else {
            const msgContainer = document.getElementById('daily-message-container');
            const msgText = document.getElementById('daily-message-text');
            if (msgContainer) msgContainer.style.display = 'none';
            if (msgText) msgText.textContent = '';
        }

    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: #f43f5e;">Error loading data: ${error.message}</td></tr>`;
        // Even if stride fetch fails, still allow importing images for the selected date.
        checkAndRenderImages(date);
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'RUN ANALYZER';
    }
}

async function getAdvice(date, maxStride, data) {
    const aiContainer = document.getElementById('daily-message-container');
    const aiText = document.getElementById('daily-message-text');

    // Show loading state
    aiContainer.style.display = 'block';
    aiText.innerHTML = '<span style="animation: pulse-glow 1.5s infinite;">Wait... AI Coach is analyzing...</span>';

    // Calculate Averages & Max for Running
    const runningData = data.filter(d => d.steps > 140);
    const totalRunningSteps = runningData.reduce((acc, d) => acc + d.steps, 0);
    const avgStride = totalRunningSteps > 0 ? (runningData.reduce((acc, d) => acc + (d.stride * d.steps), 0) / totalRunningSteps) : 0;

    // Cadence (Steps per minute)
    let maxCadence = 0;
    let sumCadence = 0;
    data.forEach(d => {
        if (d.steps > maxCadence) maxCadence = d.steps;
        if (d.steps > 140) sumCadence += d.steps;
    });
    const avgCadence = runningData.length > 0 ? (sumCadence / runningData.length) : 0;

    // Heart Rate Stats
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

    try {
        const res = await fetch('/api/advice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date,
                maxStride: Number(maxStride.toFixed(1)),
                avgStride: Number(avgStride.toFixed(1)),
                maxHR: Math.round(maxHR),
                avgHR: Math.round(avgHR),
                avgCadence: Math.round(avgCadence),
                maxCadence: Math.round(maxCadence)
            })
        });

        const text = await res.text();
        try {
            const json = JSON.parse(text);
            if (json.error) throw new Error(json.error);
            aiText.innerHTML = json.advice;
        } catch (e) {
            console.error("API Response was not JSON:", text);
            if (text.includes("<!DOCTYPE html>")) {
                aiText.innerHTML = "Error: API Endpoint not found or Server Error (HTML response). Check console.";
            } else {
                aiText.innerHTML = "AI Analysis Failed: " + (json?.error || e.message);
            }
        }
    } catch (e) {
        aiText.innerHTML = "AI Analysis Failed: " + e.message;
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
    // Set default date to today's local date.
    const dateInput = document.getElementById('dateInput');
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    dateInput.value = `${year}-${month}-${day}`;
    restoreGeminiToggle();
    bindGeminiToggle();

    loadData();

    document.getElementById('analyzeBtn').addEventListener('click', loadData);
    document.getElementById('runBatchBtn')?.addEventListener('click', runBatchFromScreen);
    document.getElementById('batchLoadImagesBtn')?.addEventListener('click', handleBatchLoadImages);
    document.getElementById('dateInput')?.addEventListener('change', loadBatchImageCandidates);

    // Modal Event Listeners
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('inboxModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('inboxModal')) closeModal();
    });
    document.getElementById('importBtn').addEventListener('click', importSelectedImages);

    // Initial History Load
    loadRunHistory();
    loadBatchImageCandidates();
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
                loadData(); // Load chart for this date

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
                    <img src="${imgUrl}" alt="Run Image">
                    ${overlayHTML}
                    <div class="delete-btn" title="Remove Link">DEL</div>
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

                // Unlink Trigger
                card.querySelector('.delete-btn').onclick = (e) => {
                    e.stopPropagation();
                    if (confirm('Are you sure you want to unlink this image?')) {
                        unlinkImage(date, img.asset_id);
                    }
                };

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
                <img src="/api/inbox/preview/${encodeURIComponent(file)}" alt="${file}">
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
                filenames: Array.from(selectedFiles),
                skipAdvice: !isGeminiEnabled()
            })
        });

        if (!res.ok) throw new Error('Import failed');

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

    if (lightbox && img) {
        img.src = src;
        lightbox.style.display = 'flex';

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
    if (lbCurrentRunId && lbCurrentAssetId) {
        if (confirm('Delete this image from run?')) {
            unlinkImage(lbCurrentRunId, lbCurrentAssetId).then(() => {
                closeLightbox();
            });
        }
    } else {
        console.error('Missing context for unlink', lbCurrentRunId, lbCurrentAssetId);
        alert('Error: Image context missing. Close and reopen to try again.');
    }
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

async function runBatchFromScreen() {
    const runBtn = document.getElementById('runBatchBtn');
    const dateInput = document.getElementById('dateInput');
    const persistToggle = document.getElementById('batchPersistToggle');
    const visionToggle = document.getElementById('batchVisionToggle');

    if (!runBtn || !dateInput) return;

    const runDate = String(dateInput.value || '').trim();
    if (!runDate) {
        renderBatchResult('Date is required.');
        return;
    }

    const filenames = getBatchFilenames();
    if (filenames.length === 0) {
        renderBatchResult('At least one stored filename is required.');
        return;
    }

    const payload = {
        persist: !!(persistToggle && persistToggle.checked),
        job: {
            job_id: '',
            source: 'screen-ui',
            use_vision_default: false
        },
        items: filenames.map((filename, idx) => ({
            item_id: `item-${idx + 1}`,
            filename,
            mode: (visionToggle && visionToggle.checked) ? 'vision' : 'mock',
            date: runDate,
            runId: runDate
        }))
    };

    const originalText = runBtn.textContent;
    const runToken = ++latestBatchRunToken;
    const expectedJobId = `ui-${Date.now()}-${runToken}`;
    payload.job.job_id = expectedJobId;
    runBtn.disabled = true;
    runBtn.textContent = 'RUNNING...';
    renderBatchResult('Running batch...');

    try {
        const res = await fetch('/api/analyze/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || `Batch failed: ${res.status}`);
        if (runToken !== latestBatchRunToken) return;
        if (data && data.job && data.job.job_id && data.job.job_id !== expectedJobId) {
            return;
        }

        renderBatchResult({
            mode: data.mode,
            job_id: data && data.job ? data.job.job_id : expectedJobId,
            total: data.total,
            success: data.success,
            failed: data.failed,
            persisted: data.persisted,
            preview: Array.isArray(data.results) ? data.results.slice(0, 3) : []
        });

        await loadRunHistory();
        await loadData();
        await loadBatchImageCandidates();
    } catch (err) {
        if (runToken !== latestBatchRunToken) return;
        renderBatchResult(`Batch Error: ${err.message}`);
    } finally {
        if (runToken === latestBatchRunToken) {
            runBtn.disabled = false;
            runBtn.textContent = originalText;
        }
    }
}

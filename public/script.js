const WR_STRIDE = 200.0;

async function loadData() {
    const dateInput = document.getElementById('dateInput');
    const date = dateInput.value;
    const summaryContainer = document.getElementById('summary');
    const tbody = document.querySelector('#resultTable tbody');
    const analyzeBtn = document.getElementById('analyzeBtn');

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'ANALYZING...';
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--text-secondary);">Loading data...</td></tr>';

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
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: var(--text-secondary);">No Running Data (Rest Day)</td></tr>';
            summaryContainer.innerHTML = ''; // Clear summary

            // Reset chart area to be blank/clean
            const ctx = document.getElementById('strideChart').getContext('2d');
            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

            // Reset AI Advice
            document.getElementById('ai-advice').innerHTML = 'Rest & Recovery is important. No analysis for today.';
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

        // Use Peak for Summary and AI
        const maxStride = maxStrideVal;
        const maxTime = data[maxIndex].time;
        // CHANGED: Use HR at the time of Max Stride (avg of window if possible, but here point value is fine as SMA is stride only)
        // Note: stridesSMA[i] corresponds to window starting at i. 
        // We should ideally take avg HR of window, or just HR at this point. 
        // Logic: google_fit_service uses avg HR of window. Here we can approximate with data[maxIndex].heartRate (center of window approx).
        // Let's use the HR at `maxIndex` as it's the start of the window.
        // Or better: calculated average of i, i+1, i+2.
        let hrAtMax = 0;
        if (maxIndex < data.length - 2) {
            hrAtMax = Math.round((data[maxIndex].heartRate + data[maxIndex + 1].heartRate + data[maxIndex + 2].heartRate) / 3);
        } else {
            hrAtMax = data[maxIndex].heartRate;
        }

        let maxHeartRate = hrAtMax;

        // Populate Table with Raw Data
        data.forEach(d => {

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${d.time}</td>
                <td>${d.steps}</td>
                <td>${d.distance.toFixed(1)}</td>
                <td class="${d.stride > 140 ? 'cell-high' : ''}">${d.stride.toFixed(1)} cm</td>
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
        getAdvice(date, maxStride, data);

        // --- NEW: Load Manual Message / Title ---
        loadDailyMessage(date);

    } catch (error) {
        console.error(error);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 20px; color: #f43f5e;">Error loading data: ${error.message}</td></tr>`;
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

    // Calculate Averages
    const totalSteps = data.reduce((acc, d) => acc + d.steps, 0);
    const avgStride = totalSteps > 0 ? (data.reduce((acc, d) => acc + (d.stride * d.steps), 0) / totalSteps) : 0;

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
                maxStride: Math.round(maxStride),
                avgStride: Math.round(avgStride),
                maxHR: Math.round(maxHR),
                avgHR: Math.round(avgHR),
                avgCadence: Math.round(avgCadence)
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
    // Set default date to today if not set or just use the one from HTML
    const dateInput = document.getElementById('dateInput');
    if (!dateInput.value) {
        dateInput.valueAsDate = new Date();
    }

    loadData();

    document.getElementById('analyzeBtn').addEventListener('click', loadData);

    // Modal Event Listeners
    document.getElementById('closeModalBtn').addEventListener('click', closeModal);
    document.getElementById('inboxModal').addEventListener('click', (e) => {
        if (e.target === document.getElementById('inboxModal')) closeModal();
    });
    document.getElementById('importBtn').addEventListener('click', importSelectedImages);

    // Initial History Load
    loadRunHistory();
});

// --- NEW: History List Logic ---
async function loadRunHistory() {
    console.log("Loading Run History..."); // Debug
    const tbody = document.querySelector('#historyTable tbody');
    if (!tbody) {
        console.error("History Table Body not found!");
        return;
    }

    try {
        const res = await fetch('/api/runs');
        if (!res.ok) throw new Error('API Failed');
        const runs = await res.json();
        console.log("Runs fetched:", runs.length); // Debug

        tbody.innerHTML = '';

        // Sort descending by date
        runs.sort((a, b) => new Date(b.date) - new Date(a.date));

        runs.forEach(run => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            tr.onclick = () => {
                console.log("Clicked run:", run.date);
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
                <td><button class="btn-primary" style="padding: 4px 10px; font-size: 0.7rem; min-width: auto;" onclick="event.stopPropagation(); deleteRun('${run.id}')">DEL</button></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Failed to load history:', err);
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Failed to load history</td></tr>';
    }
}

async function deleteRun(runId) {
    if (!confirm('Are you sure you want to delete this run?')) return;
    try {
        const res = await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
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

async function checkAndRenderImages(date) {
    const summarySection = document.getElementById('summary');
    // Remove existing image container if any
    const existingContainer = document.querySelector('.run-images-container');
    if (existingContainer) existingContainer.remove();
    const existingBtn = document.getElementById('openPickerBtn');
    if (existingBtn) existingBtn.remove();

    try {
        const res = await fetch(`/api/runs/${date}/images`);
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
                                <span class="icon">⏱️</span>
                                <span>${img.total_time}</span>
                            </div>
                            <div class="analysis-tag distance">
                                <span class="icon">📏</span>
                                <span>${distDisplay}</span>
                            </div>
                        </div>
                    `;
                }

                card.innerHTML = `
                    <img src="${imgUrl}" alt="Run Image">
                    ${overlayHTML}
                    <div class="delete-btn" title="Remove Link">🗑️</div>
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

        // 2. Render Picker Button (Always show to allow adding more)
        const btn = document.createElement('div');
        btn.id = 'openPickerBtn';
        btn.textContent = '+ Select Image from Phone Link';
        btn.onclick = () => openInboxModal(date);
        summarySection.appendChild(btn);

    } catch (err) {
        console.error('Error fetching images:', err);
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
        console.log('Fetching inbox files...');
        const res = await fetch('/api/inbox/files');
        if (!res.ok) throw new Error(`Server returned ${res.status}`);

        const files = await res.json();
        console.log('Inbox files received:', files);

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
            body: JSON.stringify({ filenames: Array.from(selectedFiles) })
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
    const analyzeBtn = document.getElementById('lbAnalyzeBtn');

    if (lightbox && img) {
        img.src = src;
        lightbox.style.display = 'flex';

        // Update Analyze Button Text
        if (analyzeBtn) {
            analyzeBtn.innerHTML = hasAnalysis
                ? '<span class="lb-btn-icon">↻</span><span class="lb-btn-text">Re-Analyze</span>'
                : '<span class="lb-btn-icon">⚡</span><span class="lb-btn-text">Analyze</span>';
        }

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
    console.log('Unlink clicked. Context:', lbCurrentRunId, lbCurrentAssetId);
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

// Analyze Button Logic
document.getElementById('lbAnalyzeBtn')?.addEventListener('click', async () => {
    if (!lbCurrentSrc) return;

    // Extract filename from URL (e.g. /assets/store/xyz.png -> xyz.png)
    const filename = lbCurrentSrc.split('/').pop();
    const btn = document.getElementById('lbAnalyzeBtn');
    const originalHTML = btn.innerHTML;

    try {
        btn.innerHTML = '<span class="lb-btn-icon">⏳</span><span class="lb-btn-text">Analyzing...</span>';
        btn.disabled = true;

        const res = await fetch('/api/analyze-vision', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        });

        const json = await res.json();

        if (!json.success) {
            throw new Error(json.error || 'Analysis failed');
        }

        const data = json.data;
        const msg = `Analysis Result:
Date: ${data.date || 'N/A'}
Steps: ${data.step_count || 'N/A'}
Distance: ${data.total_distance_km ? data.total_distance_km + 'km' : 'N/A'}
Stride: ${data.avg_stride_cm ? data.avg_stride_cm + 'cm' : 'N/A'}
Heart Rate: ${data.avg_heart_rate || 'N/A'}
Calories: ${data.calories_kcal || 'N/A'} kcal
Time: ${data.total_time || 'N/A'}`;

        alert(msg);
        // location.reload(); // Reload if we want to reflect changes immediately (optional as per improved flow)


        alert('Analysis Failed: ' + err.message);
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
});

// --- NEW: Load Daily Message ---
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

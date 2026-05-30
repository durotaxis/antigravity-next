'use client';

import { useEffect, useState } from 'react';
import EfficiencyChart from './EfficiencyChart';
// 菴懈・縺励◆繧ｳ繝ｳ繝昴・繝阪Φ繝医ｒ繧､繝ｳ繝昴・繝・
import ImageGrid from './components/ImageGrid';
import RunUploader from './components/RunUploader';
import Lightbox from './components/Lightbox';
import LegacyStrideChart from './components/LegacyStrideChart';
import LegacyMinuteDetail from './components/LegacyMinuteDetail';
function getApiBase(): string {
  const envBase = (process.env.NEXT_PUBLIC_API_URL || '').trim();
  if (envBase) return envBase;
  if (typeof window !== 'undefined') {
    const { protocol, hostname } = window.location;
    return `${protocol}//${hostname}:3000`;
  }
  return 'http://localhost:3000';
}

// 繝・・繧ｿ縺ｮ蝙句ｮ夂ｾｩ
type Run = {
  id: number;
  date: string;
  distance: number;
  time: string;
  steps: number;
  avg_stride: number;
  max_stride?: number; // Updated: consistent naming
  avg_heart_rate: number;
  max_heart_rate?: number; // Updated: consistent naming with API
  avg_cadence?: number; // New
  max_cadence?: number; // New
  avg_speed?: number; // New
  max_speed?: number; // New
  json_max_speed?: number;
  json_avg_speed?: number;
  json_avg_pitch?: number;
  json_max_pitch?: number;
  json_points?: number;
  message?: string;
  images: { id: number; url: string; alt?: string }[];
};

type ApiRun = Partial<Run> & {
  total_distance_km?: number;
  total_time?: string;
  step_count?: number;
  hr_avg?: number;
  hr_max?: number;
};

const getDefaultChartStartDate = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

function formatSpeedValue(value: number | undefined) {
  if (value === undefined || value === null || value <= 0) return '-';
  return new Intl.NumberFormat('ja-JP', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function fillRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, color: string) {
  ctx.save();
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function strokeRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number, color: string, lineWidth = 1) {
  ctx.save();
  roundRectPath(ctx, x, y, width, height, radius);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    let current = '';
    for (const char of paragraph) {
      const candidate = current + char;
      if (current && ctx.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }
    if (current) {
      lines.push(current);
    } else if (paragraph === '') {
      lines.push('');
    }
  }
  return lines;
}

async function loadCanvasImage(src: string) {
  const response = await fetch(src, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Image fetch failed: ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    const loaded = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Failed to load copied card image.'));
    });
    image.src = objectUrl;
    return await loaded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderRunCardToCanvas(run: Run) {
  const scale = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = 420;
  const padding = 20;
  const sectionGap = 18;
  const lineHeight = 22;
  const messageTitleHeight = 18;
  const messageTopPadding = 18;
  const messageBottomPadding = 16;
  const images = Array.isArray(run.images) ? run.images.slice(0, 4) : [];

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d');
  if (!measureCtx) throw new Error('Canvas context unavailable.');

  const messageWidth = width - padding * 2 - 24;
  measureCtx.font = '500 15px system-ui, sans-serif';
  const messageLines = run.message ? wrapText(measureCtx, run.message, messageWidth) : [];
  const messageHeight = run.message
    ? messageTopPadding + messageTitleHeight + messageLines.length * lineHeight + messageBottomPadding
    : 0;

  let imageHeight = 0;
  if (images.length > 0) {
    const imageGap = 12;
    const columns = 2;
    const imageSize = Math.floor((width - padding * 2 - imageGap) / columns);
    const rows = Math.ceil(images.length / columns);
    imageHeight = 24 + rows * imageSize + Math.max(0, rows - 1) * imageGap;
  }

  const distanceHeight = run.distance > 0 ? 92 : 44;
  const metricsHeight = 140;
  const totalHeight = padding + 28 + sectionGap + distanceHeight + (messageHeight ? sectionGap + messageHeight : 0) + sectionGap + metricsHeight + (imageHeight ? sectionGap + imageHeight : 0) + padding;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(totalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable.');
  ctx.scale(scale, scale);

  ctx.fillStyle = '#f3f4f6';
  ctx.fillRect(0, 0, width, totalHeight);
  fillRoundedRect(ctx, 0, 0, width, totalHeight, 20, '#ffffff');
  strokeRoundedRect(ctx, 0.5, 0.5, width - 1, totalHeight - 1, 20, '#e5e7eb', 1);

  let y = padding;

  fillRoundedRect(ctx, padding, y, 96, 30, 10, '#f9fafb');
  strokeRoundedRect(ctx, padding, y, 96, 30, 10, '#e5e7eb', 1);
  ctx.fillStyle = '#9ca3af';
  ctx.font = '600 16px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(run.date, padding + 12, y + 15);

  ctx.fillStyle = '#d1d5db';
  ctx.font = '500 14px system-ui, sans-serif';
  const idText = `ID: ${run.id}`;
  const idWidth = ctx.measureText(idText).width;
  ctx.fillText(idText, width - padding - idWidth, y + 15);

  y += 30 + sectionGap;

  if (run.distance > 0) {
    ctx.fillStyle = '#1f2937';
    ctx.font = '700 56px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(run.distance), padding, y + 48);

    const distanceWidth = ctx.measureText(String(run.distance)).width;
    ctx.fillStyle = '#6b7280';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.fillText('km', padding + distanceWidth + 8, y + 45);

    ctx.fillStyle = '#2563eb';
    ctx.font = '700 34px system-ui, sans-serif';
    ctx.fillText(`⏱ ${run.time}`, padding, y + 88);
  } else {
    fillRoundedRect(ctx, padding, y, 134, 32, 16, '#f3f4f6');
    ctx.fillStyle = '#6b7280';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('Form Analysis Data', padding + 14, y + 16);
  }

  y += distanceHeight;

  if (run.message) {
    y += sectionGap;
    fillRoundedRect(ctx, padding, y, width - padding * 2, messageHeight, 14, '#eff6ff');
    strokeRoundedRect(ctx, padding, y, width - padding * 2, messageHeight, 14, '#bfdbfe', 1);

    ctx.fillStyle = '#3b82f6';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('COACH ADVICE', padding + 16, y + 22);

    ctx.fillStyle = '#1e40af';
    ctx.font = '500 15px system-ui, sans-serif';
    messageLines.forEach((line, index) => {
      ctx.fillText(line, padding + 16, y + messageTopPadding + messageTitleHeight + index * lineHeight + 18);
    });
    y += messageHeight;
  }

  y += sectionGap;
  ctx.strokeStyle = '#f3f4f6';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, y);
  ctx.lineTo(width - padding, y);
  ctx.stroke();
  y += 14;

  const metrics = [
    {
      label1: 'STRIDE',
      label2: '(CM)',
      max: run.max_stride !== undefined && run.max_stride !== null && run.max_stride > 0 && run.max_stride <= 300 ? String(run.max_stride) : '-',
      avg: run.avg_stride !== undefined && run.avg_stride !== null ? String(run.avg_stride) : '-',
      maxColor: '#111827',
      avgColor: '#4b5563',
    },
    {
      label1: 'HR',
      label2: '(BPM)',
      max: run.max_heart_rate !== undefined && run.max_heart_rate !== null && run.max_heart_rate > 0 ? String(run.max_heart_rate) : '-',
      avg: run.avg_heart_rate !== undefined && run.avg_heart_rate !== null && run.avg_heart_rate > 0 ? String(run.avg_heart_rate) : '-',
      maxColor: '#b91c1c',
      avgColor: '#ef4444',
    },
    {
      label1: 'SPEED',
      label2: '(KM/H)',
      max: formatSpeedValue(run.max_speed),
      avg: formatSpeedValue(run.avg_speed),
      maxColor: '#4338ca',
      avgColor: '#6366f1',
    },
    {
      label1: 'PITCH',
      label2: '(SPM)',
      max: run.max_cadence !== undefined && run.max_cadence !== null && run.max_cadence > 0 ? String(run.max_cadence) : '-',
      avg: run.avg_cadence !== undefined && run.avg_cadence !== null && run.avg_cadence > 0 ? String(run.avg_cadence) : '-',
      maxColor: '#047857',
      avgColor: '#10b981',
    },
  ];

  const columnWidth = (width - padding * 2) / 4;
  metrics.forEach((metric, index) => {
    const x = padding + index * columnWidth;
    if (index > 0) {
      ctx.strokeStyle = '#f3f4f6';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 112);
      ctx.stroke();
    }

    ctx.fillStyle = '#9ca3af';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(metric.label1, x + 12, y + 16);
    ctx.fillText(metric.label2, x + 12, y + 32);

    ctx.fillStyle = '#9ca3af';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillText('Max', x + 12, y + 62);
    ctx.fillText('Avg', x + 12, y + 96);

    ctx.textAlign = 'right';
    ctx.fillStyle = metric.maxColor;
    ctx.font = '700 28px system-ui, sans-serif';
    ctx.fillText(metric.max, x + columnWidth - 12, y + 66);
    ctx.fillStyle = metric.avgColor;
    ctx.fillText(metric.avg, x + columnWidth - 12, y + 100);
    ctx.textAlign = 'left';
  });

  y += metricsHeight;

  if (images.length > 0) {
    y += sectionGap;
    ctx.strokeStyle = '#f3f4f6';
    ctx.beginPath();
    ctx.moveTo(padding, y);
    ctx.lineTo(width - padding, y);
    ctx.stroke();
    y += 24;

    ctx.fillStyle = '#9ca3af';
    ctx.font = '700 12px system-ui, sans-serif';
    ctx.fillText('ANALYSIS IMAGES', padding, y);
    y += 12;

    const imageGap = 12;
    const columns = 2;
    const imageSize = Math.floor((width - padding * 2 - imageGap) / columns);

    const loadedImages = await Promise.all(
      images.map(async (image) => {
        try {
          return await loadCanvasImage(image.url);
        } catch (error) {
          console.warn('Failed to load image for copied run card:', error);
          return null;
        }
      })
    );

    loadedImages.forEach((image, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = padding + col * (imageSize + imageGap);
      const cellY = y + row * (imageSize + imageGap);

      fillRoundedRect(ctx, x, cellY, imageSize, imageSize, 14, '#f3f4f6');
      if (image) {
        ctx.save();
        roundRectPath(ctx, x, cellY, imageSize, imageSize, 14);
        ctx.clip();

        const sourceRatio = image.width / image.height;
        const targetRatio = 1;
        let drawWidth = imageSize;
        let drawHeight = imageSize;
        let drawX = x;
        let drawY = cellY;

        if (sourceRatio > targetRatio) {
          drawWidth = imageSize * sourceRatio;
          drawX = x - (drawWidth - imageSize) / 2;
        } else {
          drawHeight = imageSize / sourceRatio;
          drawY = cellY - (drawHeight - imageSize) / 2;
        }

        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();
      }
      strokeRoundedRect(ctx, x, cellY, imageSize, imageSize, 14, '#e5e7eb', 1);
    });
  }

  return canvas;
}

async function copyCanvasToClipboard(canvas: HTMLCanvasElement) {
  if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem === 'undefined') {
    return false;
  }
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  return true;
}

async function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) {
    throw new Error('Failed to export card image.');
  }
  const link = document.createElement('a');
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}

export default function Home() {
  const API_BASE = getApiBase();
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [legacyChartDate, setLegacyChartDate] = useState<string | null>(null);
  const [legacyDetailDate, setLegacyDetailDate] = useState<string | null>(null);
  const [chartStartDate, setChartStartDate] = useState<string | null>(getDefaultChartStartDate());

  const formatSpeed = formatSpeedValue;

  // Lightbox逕ｨ縺ｮ迥ｶ諷狗ｮ｡逅・
  const [lightboxData, setLightboxData] = useState<{ url: string; assetId: number; runId: number; runDate: string } | null>(null);

  // Lightbox繧帝幕縺城未謨ｰ
  const openLightbox = (url: string, assetId: number, runId: number, runDate: string) => {
    setLightboxData({ url, assetId, runId, runDate });
  };

  const closeLightbox = () => setLightboxData(null);
  const closeLegacyChart = () => setLegacyChartDate(null);
  const closeLegacyDetail = () => setLegacyDetailDate(null);

  const copyRunCard = async (run: Run) => {
    try {
      const canvas = await renderRunCardToCanvas(run);
      const copied = await copyCanvasToClipboard(canvas);
      if (copied) {
        alert('Run card copied to clipboard as PNG.');
        return;
      }

      await downloadCanvas(canvas, `${run.date}-run-card.png`);
      alert('Clipboard image copy is unavailable in this browser. Downloaded PNG instead.');
    } catch (error) {
      console.error('Failed to copy run card:', error);
      alert('Failed to copy the run card image.');
    }
  };

  const isToday = (dateStr: string) => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return dateStr === `${y}-${m}-${day}`;
  };

  const isEmptyRunCard = (run: Run) => {
    const hasDistance = Number(run.distance || 0) > 0;
    const hasSteps = Number(run.steps || 0) > 0;
    const hasStride = Number(run.avg_stride || 0) > 0 || Number(run.max_stride || 0) > 0;
    const hasHr = Number(run.avg_heart_rate || 0) > 0 || Number(run.max_heart_rate || 0) > 0;
    const hasSpeed = Number(run.avg_speed || 0) > 0 || Number(run.max_speed || 0) > 0;
    const hasCadence = Number(run.avg_cadence || 0) > 0 || Number(run.max_cadence || 0) > 0;
    const hasMessage = typeof run.message === 'string' && run.message.trim().length > 0;
    return !(hasDistance || hasSteps || hasStride || hasHr || hasSpeed || hasCadence || hasMessage);
  };

  // Express (Port 3000) 縺九ｉ繝・・繧ｿ繧貞叙蠕・
  useEffect(() => {
    fetch(`${API_BASE}/api/runs?includeDerived=1`)
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          const normalizedRuns: Run[] = (data as ApiRun[]).map((run) => ({
            ...run,
            id: Number(run.id ?? 0),
            date: String(run.date ?? ''),
            distance: Number(run.total_distance_km ?? run.distance ?? 0),
            time: run.total_time ?? run.time ?? '00:00:00',
            steps: Number(run.step_count ?? run.steps ?? 0),
            avg_heart_rate: Number(run.avg_heart_rate ?? run.hr_avg ?? 0),
            max_heart_rate: Number(run.max_heart_rate ?? run.hr_max ?? 0),
            avg_stride: Number(run.avg_stride ?? 0),
            avg_speed: Number(run.avg_speed ?? run.json_avg_speed ?? 0),
            max_speed: Number(run.max_speed ?? run.json_max_speed ?? 0),
            avg_cadence: Number(run.avg_cadence ?? run.json_avg_pitch ?? 0),
            max_cadence: Number(run.max_cadence ?? run.json_max_pitch ?? 0),
            images: Array.isArray(run.images) ? run.images : []
          }));
          const filteredRuns = normalizedRuns.filter((run) => {
            // Hide today's placeholder-only card (often created before run data is ready).
            if (isToday(run.date) && isEmptyRunCard(run)) return false;
            return true;
          });
          setRuns(filteredRuns);
          setError(null);
        } else {
          console.error("API Error:", data);
          setError(JSON.stringify(data));
        }
      })
      .catch((err) => {
        console.error('Fetch error:', err);
        setError('Failed to fetch data');
      });
  }, [API_BASE]);

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">

      {/* Lightbox (繝｢繝ｼ繝繝ｫ陦ｨ遉ｺ) */}
      {/* Lightbox (繝｢繝ｼ繝繝ｫ陦ｨ遉ｺ) */}
      <Lightbox
        isOpen={!!lightboxData}
        imageSrc={lightboxData?.url || null}
        onClose={closeLightbox}
      />
      {legacyChartDate && (
        <LegacyStrideChart
          date={legacyChartDate}
          apiBase={API_BASE}
          onClose={closeLegacyChart}
        />
      )}
      {legacyDetailDate && (
        <LegacyMinuteDetail
          date={legacyDetailDate}
          apiBase={API_BASE}
          onClose={closeLegacyDetail}
        />
      )}

      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-800 tracking-tight mb-6">
          🏃‍♂️ AntiGravity <span className="text-blue-600">Next</span>
        </h1>
        {/* Upload Component */}
        <RunUploader />
      </header>

      {/* Chart Date Range Filter */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">
            Chart Start Date:
          </label>
          <input
            type="date"
            value={chartStartDate || ''}
            onChange={(e) => setChartStartDate(e.target.value || null)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          {chartStartDate && (
            <button
              onClick={() => setChartStartDate(null)}
              className="text-xs px-3 py-2 rounded bg-gray-200 text-gray-700 hover:bg-gray-300"
            >
              Clear Filter
            </button>
          )}
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}

      {/* グラフエリア */}
      <div className="mb-10 bg-white rounded-xl shadow-sm border border-gray-100">
        <EfficiencyChart runs={runs} startDate={chartStartDate} />
      </div>

      {/* データリスト表示エリア */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.isArray(runs) && runs.map((run) => (
          <div
            key={run.id}
            id={`run-card-${run.id}`}
            className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden border border-gray-100 flex flex-col"
          >
            <div className="p-5 flex-grow">

              {/* 譌･莉倥・繝・ム繝ｼ */}
              <div className="flex justify-between items-center mb-4 relative group-card-header">
                <span className="text-sm font-medium text-gray-400 bg-gray-50 px-2 py-1 rounded">
                  {run.date}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-300">ID: {run.id}</span>
                  <button
                    type="button"
                    onClick={() => copyRunCard(run)}
                    className="text-[11px] font-semibold px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                  >
                    COPY CARD
                  </button>
                </div>

              </div>

              {/* 霍晞屬縺ｨ譎る俣・医ョ繝ｼ繧ｿ縺後≠繧句ｴ蜷医・縺ｿ陦ｨ遉ｺ・・*/}
              {run.distance > 0 ? (
                <>
                  <div className="flex items-baseline gap-1 mb-2">
                    <span className="text-4xl font-bold text-gray-800">{run.distance}</span>
                    <span className="text-sm text-gray-500 font-medium">km</span>
                  </div>
                  <div className="text-lg font-semibold text-blue-600 mb-4 flex items-center gap-2">
                    ⏱ {run.time}
                  </div>
                </>
              ) : (
                <div className="mb-6 mt-2">
                  <span className="inline-block bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded-full">
                    Form Analysis Data
                  </span>
                </div>
              )}

              {/* Message Display */}
              {run.message && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-800">
                  <span className="block text-xs font-bold text-blue-400 uppercase mb-1">Coach Advice</span>
                  {run.message}
                </div>
              )}

              {/* 繧ｹ繝医Λ繧､繝峨→蠢・牛謨ｰ (Avg / Max) */}
              {/* 繧ｹ繝医Λ繧､繝峨→蠢・牛謨ｰ (Max Top / Avg Bottom) */}
              <div className="grid grid-cols-4 gap-3 pt-4 border-t border-gray-50 text-center">

                {/* Stride Column */}
                <div>
                  <span className="block text-xs uppercase tracking-wide text-gray-400 mb-2 leading-tight">
                    <span className="block">Stride</span>
                    <span className="block">(cm)</span>
                  </span>
                  <div className="flex flex-col items-stretch gap-1">
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span className="text-[10px] text-gray-400 font-medium w-7 shrink-0 text-left">Max</span>
                      <span className="font-bold text-gray-900 text-lg leading-none tabular-nums flex-1 text-right">
                        {run.max_stride !== undefined && run.max_stride !== null && run.max_stride > 0 && run.max_stride <= 300
                          ? run.max_stride
                          : '-'}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span className="text-[10px] text-gray-400 font-medium w-7 shrink-0 text-left">Avg</span>
                      <span className="font-bold text-gray-700 text-lg leading-none tabular-nums flex-1 text-right">
                        {run.avg_stride !== undefined && run.avg_stride !== null ? run.avg_stride : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Heart Rate Column */}
                <div className="border-l border-gray-50">
                  <span className="block text-xs uppercase tracking-wide text-gray-400 mb-2 leading-tight">
                    <span className="block">HR</span>
                    <span className="block">(bpm)</span>
                  </span>
                  <div className="flex flex-col items-stretch gap-1">
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span aria-hidden="true" className="w-7 shrink-0" />
                      <span className="sr-only">Max</span>
                      <span className="font-bold text-red-700 text-lg leading-none tabular-nums flex-1 text-right">
                        {run.max_heart_rate !== undefined && run.max_heart_rate !== null && run.max_heart_rate > 0
                          ? run.max_heart_rate
                          : '-'}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span aria-hidden="true" className="w-7 shrink-0" />
                      <span className="sr-only">Avg</span>
                      <span className="font-bold text-red-500 text-lg leading-none tabular-nums flex-1 text-right">
                        {run.avg_heart_rate !== undefined && run.avg_heart_rate !== null && run.avg_heart_rate > 0 ? run.avg_heart_rate : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Speed Column (New) */}
                <div className="border-l border-gray-50">
                  <span className="block text-xs uppercase tracking-wide text-gray-400 mb-2 leading-tight">
                    <span className="block">Speed</span>
                    <span className="block">(km/h)</span>
                  </span>
                  <div className="flex flex-col items-stretch gap-1">
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span aria-hidden="true" className="w-7 shrink-0" />
                      <span className="sr-only">Max</span>
                      <span className="font-bold text-indigo-700 text-lg leading-none tabular-nums flex-1 text-right">
                        {run.max_speed !== undefined && run.max_speed !== null && run.max_speed > 0
                          ? formatSpeed(run.max_speed)
                          : '-'}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span aria-hidden="true" className="w-7 shrink-0" />
                      <span className="sr-only">Avg</span>
                      <span className="font-bold text-indigo-500 text-lg leading-none tabular-nums flex-1 text-right">
                        {formatSpeed(run.avg_speed)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Pitch Column (New) */}
                <div className="border-l border-gray-50">
                  <span className="block text-xs uppercase tracking-wide text-gray-400 mb-2 leading-tight">
                    <span className="block">Pitch</span>
                    <span className="block">(spm)</span>
                  </span>
                  <div className="flex flex-col items-stretch gap-1">
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span aria-hidden="true" className="w-7 shrink-0" />
                      <span className="sr-only">Max</span>
                      <span className="font-bold text-emerald-700 text-lg leading-none tabular-nums flex-1 text-right">
                        {run.max_cadence !== undefined && run.max_cadence !== null && run.max_cadence > 0 ? run.max_cadence : '-'}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span aria-hidden="true" className="w-7 shrink-0" />
                      <span className="sr-only">Avg</span>
                      <span className="font-bold text-emerald-500 text-lg leading-none tabular-nums flex-1 text-right">
                        {run.avg_cadence !== undefined && run.avg_cadence !== null && run.avg_cadence > 0 ? run.avg_cadence : '-'}
                      </span>
                    </div>
                  </div>
                </div>

              </div>

              {/* 逕ｻ蜒上げ繝ｪ繝・ラ (譛ｬ逡ｪ繝・・繧ｿ) */}
              

              <div className="mt-6 border-t border-gray-50 pt-4">
                <p className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Analysis Images</p>
                {run.images && run.images.length > 0 ? (
                  <ImageGrid
                    images={run.images}
                    onImageClick={(url, assetId) => openLightbox(url, assetId, run.id, run.date)}
                  />
                ) : (
                  <p className="text-xs text-gray-400 italic">No images available</p>
                )}
              </div>

            </div>
          </div>
        ))}
      </div>
    </div>
  );
}




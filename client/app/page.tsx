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

export default function Home() {
  const API_BASE = getApiBase();
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [legacyChartDate, setLegacyChartDate] = useState<string | null>(null);
  const [legacyDetailDate, setLegacyDetailDate] = useState<string | null>(null);
  const [chartStartDate, setChartStartDate] = useState<string | null>(getDefaultChartStartDate());

  const formatSpeed = (value: number | undefined) => {
    if (value === undefined || value === null || value <= 0) return '-';
    return new Intl.NumberFormat('ja-JP', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Lightbox逕ｨ縺ｮ迥ｶ諷狗ｮ｡逅・
  const [lightboxData, setLightboxData] = useState<{ url: string; assetId: number; runId: number; runDate: string } | null>(null);

  // Lightbox繧帝幕縺城未謨ｰ
  const openLightbox = (url: string, assetId: number, runId: number, runDate: string) => {
    setLightboxData({ url, assetId, runId, runDate });
  };

  const closeLightbox = () => setLightboxData(null);
  const closeLegacyChart = () => setLegacyChartDate(null);
  const closeLegacyDetail = () => setLegacyDetailDate(null);

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
          <div key={run.id} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden border border-gray-100 flex flex-col">
            <div className="p-5 flex-grow">

              {/* 譌･莉倥・繝・ム繝ｼ */}
              <div className="flex justify-between items-center mb-4 relative group-card-header">
                <span className="text-sm font-medium text-gray-400 bg-gray-50 px-2 py-1 rounded">
                  {run.date}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-300">ID: {run.id}</span>
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




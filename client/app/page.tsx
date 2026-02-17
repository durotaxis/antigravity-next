'use client';

import { useEffect, useState } from 'react';
import EfficiencyChart from './EfficiencyChart';
// 作成したコンポーネントをインポート
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

// データの型定義
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

export default function Home() {
  const API_BASE = getApiBase();
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [legacyChartDate, setLegacyChartDate] = useState<string | null>(null);
  const [legacyDetailDate, setLegacyDetailDate] = useState<string | null>(null);
  const [heightCm, setHeightCm] = useState<string>('');

  const formatSpeed = (value: number | undefined) => {
    if (value === undefined || value === null || value <= 0) return '-';
    return new Intl.NumberFormat('ja-JP', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  };

  // Lightbox用の状態管理
  const [lightboxData, setLightboxData] = useState<{ url: string; assetId: number; runId: number; runDate: string } | null>(null);

  // Lightboxを開く関数
  const openLightbox = (url: string, assetId: number, runId: number, runDate: string) => {
    setLightboxData({ url, assetId, runId, runDate });
  };

  const closeLightbox = () => setLightboxData(null);
  const closeLegacyChart = () => setLegacyChartDate(null);
  const closeLegacyDetail = () => setLegacyDetailDate(null);

  // Express (Port 3000) からデータを取得
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
            images: Array.isArray(run.images) ? run.images : []
          }));
          setRuns(normalizedRuns);
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

  useEffect(() => {
    try {
      const stored = localStorage.getItem('profile.height_cm');
      if (stored) setHeightCm(stored);
    } catch {
      // ignore localStorage failures
    }
  }, []);

  const handleSaveHeight = () => {
    const v = Number(heightCm);
    if (!Number.isFinite(v) || v < 100 || v > 250) {
      alert('身長は 100〜250 cm で入力してください');
      return;
    }
    const rounded = String(Math.round(v));
    try {
      localStorage.setItem('profile.height_cm', rounded);
      setHeightCm(rounded);
    } catch {
      alert('身長の保存に失敗しました');
    }
  };

  // 画像削除ハンドラ
  const handleDeleteImage = async (runId: number, runDate: string, assetId: number) => {
    if (!confirm('Remove this image link? (The daily summary will remain)')) return;

    try {
      // NOTE: run_imagesテーブルは date を run_id として使用しているため、APIには date を渡す必要がある
      const res = await fetch(`${API_BASE}/api/runs/${runDate}/images/${assetId}`, {
        method: 'DELETE',
      });

      if (res.ok) {
        // UI側の状態も更新（リロードせずに反映）
        setRuns(prevRuns => prevRuns.map(run => {
          if (run.id === runId) {
            return {
              ...run,
              images: run.images.filter(img => img.id !== assetId)
            };
          }
          return run;
        }));
      } else {
        alert('Failed to delete image');
      }
    } catch (err) {
      console.error(err);
      alert('Error deleting image');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">

      {/* Lightbox (モーダル表示) */}
      {/* Lightbox (モーダル表示) */}
      <Lightbox
        isOpen={!!lightboxData}
        imageSrc={lightboxData?.url || null}
        onClose={closeLightbox}
        onDelete={() => {
          if (lightboxData) {
            handleDeleteImage(lightboxData.runId, lightboxData.runDate, lightboxData.assetId);
            closeLightbox();
          }
        }}
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

        <div className="mb-4 bg-white border border-gray-100 rounded-lg p-3 flex items-center gap-2">
          <label htmlFor="height-cm" className="text-sm text-gray-600 font-medium">
            身長(cm)
          </label>
          <input
            id="height-cm"
            type="number"
            min={100}
            max={250}
            step={1}
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            className="w-24 px-2 py-1 rounded border border-gray-200 text-sm"
            placeholder="170"
          />
          <button
            onClick={handleSaveHeight}
            className="px-3 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700"
          >
            保存
          </button>
        </div>

        {/* Upload Component */}
        <RunUploader />
      </header>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          <strong className="font-bold">Error: </strong>
          <span className="block sm:inline">{error}</span>
        </div>
      )}

      {/* グラフエリア */}
      <div className="mb-10 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <EfficiencyChart runs={runs} />
      </div>

      {/* データリスト表示エリア */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.isArray(runs) && runs.map((run) => (
          <div key={run.id} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow duration-300 overflow-hidden border border-gray-100 flex flex-col">
            <div className="p-5 flex-grow">

              {/* 日付ヘッダー */}
              <div className="flex justify-between items-center mb-4 relative group-card-header">
                <span className="text-sm font-medium text-gray-400 bg-gray-50 px-2 py-1 rounded">
                  {run.date}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setLegacyChartDate(run.date)}
                    className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-100"
                  >
                    Chart
                  </button>
                  <button
                    onClick={() => setLegacyDetailDate(run.date)}
                    className="text-[10px] uppercase tracking-wide px-2 py-1 rounded bg-cyan-50 text-cyan-700 hover:bg-cyan-100 border border-cyan-100"
                  >
                    Detail
                  </button>
                  <span className="text-xs text-gray-300">ID: {run.id}</span>
                </div>

                {/* 削除ボタン (Trash Icon) */}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('Are you sure you want to delete this record? This cannot be undone.')) return;

                    try {
                      const res = await fetch(`${API_BASE}/api/runs/${run.id}`, { method: 'DELETE' });
                      if (res.ok) {
                        window.location.reload();
                      } else {
                        throw new Error('Delete failed');
                      }
                    } catch (err) {
                      alert('Failed to delete run');
                      console.error(err);
                    }
                  }}
                  className="absolute -right-2 -top-2 p-2 text-gray-400 hover:text-red-500 bg-white/80 hover:bg-red-50 rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-sm"
                  title="Delete Run"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>

              {/* 距離と時間（データがある場合のみ表示） */}
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

              {/* ストライドと心拍数 (Avg / Max) */}
              {/* ストライドと心拍数 (Max Top / Avg Bottom) */}
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

              {/* 画像グリッド (本番データ) */}
              

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

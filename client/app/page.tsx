'use client';

import { useEffect, useState } from 'react';
import EfficiencyChart from './EfficiencyChart';
// 作成したコンポーネントをインポート
import ImageGrid from './components/ImageGrid';
import RunUploader from './components/RunUploader';
import Lightbox from './components/Lightbox';

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

export default function Home() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Lightbox用の状態管理
  const [lightboxData, setLightboxData] = useState<{ url: string; assetId: number; runId: number; runDate: string } | null>(null);

  // Lightboxを開く関数
  const openLightbox = (url: string, assetId: number, runId: number, runDate: string) => {
    setLightboxData({ url, assetId, runId, runDate });
  };

  const closeLightbox = () => setLightboxData(null);

  // Express (Port 3000) からデータを取得
  useEffect(() => {
    fetch('http://192.168.3.153:3000/api/runs?includeDerived=1')
      .then((res) => res.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setRuns(data);
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
  }, []);

  // 画像削除ハンドラ
  const handleDeleteImage = async (runId: number, runDate: string, assetId: number) => {
    if (!confirm('Remove this image link? (The daily summary will remain)')) return;

    try {
      // NOTE: run_imagesテーブルは date を run_id として使用しているため、APIには date を渡す必要がある
      const res = await fetch(`http://192.168.3.153:3000/api/runs/${runDate}/images/${assetId}`, {
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

      <header className="mb-8">
        <h1 className="text-3xl font-extrabold text-gray-800 tracking-tight mb-6">
          🏃‍♂️ AntiGravity <span className="text-blue-600">Next</span>
        </h1>

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
                <span className="text-xs text-gray-300">ID: {run.id}</span>

                {/* 削除ボタン (Trash Icon) */}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm('Are you sure you want to delete this record? This cannot be undone.')) return;

                    try {
                      const res = await fetch(`http://192.168.3.153:3000/api/runs/${run.id}`, { method: 'DELETE' });
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
                          : (run.avg_stride !== undefined && run.avg_stride !== null && run.avg_stride > 0 ? run.avg_stride : '-')}
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
                          : (run.avg_heart_rate !== undefined && run.avg_heart_rate !== null && run.avg_heart_rate > 0 ? run.avg_heart_rate : '-')}
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
                          ? run.max_speed.toFixed(1)
                          : (run.avg_speed !== undefined && run.avg_speed !== null && run.avg_speed > 0 ? run.avg_speed.toFixed(1) : '-')}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2 min-h-[22px] w-full">
                      <span aria-hidden="true" className="w-7 shrink-0" />
                      <span className="sr-only">Avg</span>
                      <span className="font-bold text-indigo-500 text-lg leading-none tabular-nums flex-1 text-right">
                        {run.avg_speed !== undefined && run.avg_speed !== null && run.avg_speed > 0 ? run.avg_speed.toFixed(1) : '-'}
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
              {(run.json_avg_speed || run.json_max_speed || run.json_avg_pitch || run.json_max_pitch) ? (
                <div className="mt-3 text-[10px] text-gray-400 flex justify-between">
                  <span className="uppercase tracking-wide">JSON calc</span>
                  <span className="tabular-nums text-right">
                    Speed avg {run.json_avg_speed !== undefined && run.json_avg_speed !== null ? run.json_avg_speed.toFixed(1) : '-'} max {run.json_max_speed !== undefined && run.json_max_speed !== null ? run.json_max_speed.toFixed(1) : '-'} / Pitch avg {run.json_avg_pitch ?? '-'} max {run.json_max_pitch ?? '-'}
                  </span>
                </div>
              ) : null}

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

'use client';

import { useEffect, useMemo, useState } from 'react';

type ApiStridePoint = {
  time?: string;
  steps?: number;
  distance?: number;
  stride?: number;
  heartRate?: number;
};

type Row = {
  time: string;
  steps: number;
  distance: number;
  stride: number;
  velocity: number;
  heartRate: number;
};

type Props = {
  date: string;
  apiBase: string;
  onClose: () => void;
};

export default function LegacyMinuteDetail({ date, apiBase, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/api/stride?date=${encodeURIComponent(date)}`);
        if (!res.ok) throw new Error(`Failed to fetch detail: ${res.status}`);
        const json: unknown = await res.json();
        if (!alive) return;
        if (!Array.isArray(json)) {
          setRows([]);
          setError('Invalid detail data');
          return;
        }
        const next = (json as ApiStridePoint[]).map((p) => {
          const distance = Number(p?.distance ?? 0);
          return {
            time: String(p?.time ?? ''),
            steps: Number(p?.steps ?? 0),
            distance,
            stride: Number(p?.stride ?? 0),
            velocity: Number.isFinite(distance) ? Number((distance * 0.06).toFixed(1)) : 0,
            heartRate: Number(p?.heartRate ?? 0)
          };
        });
        setRows(next);
      } catch (e: unknown) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : 'Failed to load detail';
        setRows([]);
        setError(msg);
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [date, apiBase]);

  const hasRows = rows.length > 0;
  const summary = useMemo(() => {
    if (!hasRows) return null;
    const maxStride = Math.max(...rows.map((r) => r.stride || 0));
    const maxHr = Math.max(...rows.map((r) => r.heartRate || 0));
    return { maxStride, maxHr, points: rows.length };
  }, [rows, hasRows]);

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-[85vh] overflow-hidden border border-gray-200">
        <div className="h-12 border-b border-gray-100 px-4 flex items-center justify-between">
          <div className="text-sm text-gray-700 font-medium">Minute Detail: {date}</div>
          <button
            onClick={onClose}
            className="text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            Close
          </button>
        </div>

        <div className="h-[calc(85vh-48px)] p-4 overflow-auto">
          {loading && <div className="text-sm text-gray-500">Loading detail...</div>}
          {!loading && error && <div className="text-sm text-red-500">{error}</div>}
          {!loading && !error && !hasRows && (
            <div className="text-sm text-gray-500">No running data for this date.</div>
          )}
          {!loading && !error && hasRows && (
            <>
              {summary && (
                <div className="mb-3 text-xs text-gray-500">
                  points: {summary.points} / max stride: {summary.maxStride.toFixed(1)} cm / max HR: {Math.round(summary.maxHr)}
                </div>
              )}
              <div className="border border-gray-100 rounded-md overflow-hidden">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 text-gray-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Time</th>
                      <th className="px-3 py-2 text-right">Steps</th>
                      <th className="px-3 py-2 text-right">Dist (m)</th>
                      <th className="px-3 py-2 text-right">Stride (cm)</th>
                      <th className="px-3 py-2 text-right">Velocity (km/h)</th>
                      <th className="px-3 py-2 text-right">Heart Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr key={`${r.time}-${idx}`} className="border-t border-gray-100">
                        <td className="px-3 py-2">{r.time}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.steps}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.distance.toFixed(1)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.stride > 0 ? r.stride.toFixed(1) : '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-cyan-600">{r.velocity > 0 ? r.velocity.toFixed(1) : '-'}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-rose-600">{r.heartRate > 0 ? Math.round(r.heartRate) : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

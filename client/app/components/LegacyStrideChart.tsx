'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

type StridePoint = {
  time: string;
  stride: number;
  heartRate: number;
};

type ApiStridePoint = {
  time?: string;
  stride?: number;
  heartRate?: number;
};

type Props = {
  date: string;
  apiBase: string;
  onClose: () => void;
};

// Legacy (old screen) chart appears much flatter, effectively around ~5:1.
const CHART_ASPECT_RATIO = 5;

export default function LegacyStrideChart({ date, apiBase, onClose }: Props) {
  const [data, setData] = useState<StridePoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/api/stride?date=${encodeURIComponent(date)}`);
        if (!res.ok) throw new Error(`Failed to fetch stride data: ${res.status}`);
        const rows: unknown = await res.json();
        if (!alive) return;
        if (!Array.isArray(rows)) {
          setData([]);
          setError('Invalid chart data');
          return;
        }
        const normalized: StridePoint[] = (rows as ApiStridePoint[]).map((p) => ({
          time: String(p?.time ?? ''),
          stride: Number(p?.stride ?? 0),
          heartRate: Number(p?.heartRate ?? 0)
        }));
        setData(normalized);
      } catch (e: unknown) {
        if (!alive) return;
        setData([]);
        const msg = e instanceof Error ? e.message : 'Failed to load chart';
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

  const hasPoints = data.length > 0;
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        time: d.time,
        stride: Number.isFinite(d.stride) && d.stride > 0 ? d.stride : null,
        heartRate: Number.isFinite(d.heartRate) && d.heartRate > 0 ? d.heartRate : null
      })),
    [data]
  );

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-[85vh] overflow-hidden border border-gray-200">
        <div className="h-12 border-b border-gray-100 px-4 flex items-center justify-between">
          <p className="text-sm text-gray-700 font-medium">Legacy Chart: {date}</p>
          <button
            onClick={onClose}
            className="text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            Close
          </button>
        </div>

        <div className="h-[calc(85vh-48px)] p-4 bg-white">
          {loading && (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              Loading chart...
            </div>
          )}
          {!loading && error && (
            <div className="h-full flex items-center justify-center text-sm text-red-500">{error}</div>
          )}
          {!loading && !error && !hasPoints && (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
              No running data for this date.
            </div>
          )}
          {!loading && !error && hasPoints && (
            <ResponsiveContainer width="100%" aspect={CHART_ASPECT_RATIO}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  tickLine={false}
                />
                <YAxis
                  yAxisId="left"
                  stroke="#06b6d4"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'Stride (cm)', angle: -90, position: 'insideLeft', fill: '#06b6d4', fontSize: 10 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  stroke="#e11d48"
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  label={{ value: 'Heart Rate (bpm)', angle: 90, position: 'insideRight', fill: '#e11d48', fontSize: 10 }}
                />
                <Tooltip />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="stride"
                  name="Stride"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="heartRate"
                  name="HR"
                  stroke="#e11d48"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}

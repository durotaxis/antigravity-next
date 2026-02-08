'use client';

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';

type Run = {
  id: number;
  date: string;
  avg_stride: number;
  avg_heart_rate: number;
  max_stride?: number | null;
  max_heart_rate?: number | null; // Updated to match API
  hr_max?: number | null; // Compatibility
  max_stride_5p?: number | null;
  max_hr_5p?: number | null;
};

type Props = {
  runs: Run[];
};

export default function EfficiencyChart({ runs }: Props) {
  // 1. 日付順にソート
  const sortedRuns = [...runs].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 2. 表示用データの加工 (Simple Max Only)
  const chartData = sortedRuns.map(run => {
    // User requested RAW daily summary max values
    // Using max_heart_rate from API (or hr_max if passed that way)
    let displayHr = run.max_heart_rate || run.hr_max || 0;
    let displayStride = run.max_stride || 0;

    // Apply Filters (Matching Old Screen Logic)
    // 1. Invalid Stride > 300cm
    if (displayStride > 300) displayStride = 0;
    // 2. Invalid HR <= 100 or Missing (0) -> Invalidate Stride
    if (displayHr <= 100) displayStride = 0;

    return {
      ...run,
      displayStride,
      displayHr,
      isEstimated: false // No longer estimating
    };
  });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const year = d.getFullYear().toString().slice(-2);
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${year}/${month}/${day}`;
  };

  // カスタムツールチップ
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded text-sm">
          <p className="font-bold text-gray-700 mb-1">{formatDate(data.date)}</p>
          <div className="space-y-1">
            <p className="text-blue-600">
              Stride: <strong>{data.displayStride}</strong> cm
            </p>
            <p className="text-red-500">
              Heart Rate: <strong>{data.displayHr}</strong> bpm
            </p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-96 bg-white p-4 rounded-lg shadow-sm">
      <h2 className="text-sm font-semibold text-gray-700 mb-1 text-center">
        Performance Trend
      </h2>
      <p className="text-xs text-center text-gray-400 mb-4">
        Max Stride / Heart Rate
      </p>

      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />

          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={false}
            dy={10}
          />

          <YAxis
            yAxisId="left"
            orientation="left"
            stroke="#3b82f6"
            domain={[0, 'auto']}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Stride (cm)', angle: -90, position: 'insideLeft', fill: '#3b82f6', fontSize: 10 }}
          />

          <YAxis
            yAxisId="right"
            orientation="right"
            stroke="#ef4444"
            domain={[0, 'auto']}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Heart Rate (bpm)', angle: 90, position: 'insideRight', fill: '#ef4444', fontSize: 10 }}
          />

          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ paddingTop: '20px' }} />

          {/* Stride Line */}
          <Line
            yAxisId="left"
            type="monotone" // 滑らかにつなぐ
            dataKey="displayStride"
            name="Max Stride"
            stroke="#3b82f6"
            strokeWidth={3}
            dot={{ r: 4, strokeWidth: 2 }}
            activeDot={{ r: 6 }}
            connectNulls={true}
          />

          {/* Heart Rate Line */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="displayHr"
            name="Heart Rate"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls={true}
          />

        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
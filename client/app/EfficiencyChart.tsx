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
  max_stride?: number | null; // DB上のMax
  hr_max?: number | null;     // DB上のMax
  max_stride_5p?: number | null; // vNext計算値
  max_hr_5p?: number | null;     // vNext計算値
};

type Props = {
  runs: Run[];
};

export default function EfficiencyChart({ runs }: Props) {
  // 1. 日付順にソート
  const sortedRuns = [...runs].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 2. 表示用データの加工 (自動フォールバック)
  // vNext(5P SMA)がない日は、既存の平均値(Avg)を使ってグラフをつなぐ
  const chartData = sortedRuns.map(run => {
    // ストライドの決定: 5P SMA -> DB Max -> DB Avg の順で存在するものを採用
    let displayStride = run.max_stride_5p;
    if (!displayStride || displayStride === 0) displayStride = run.max_stride;
    if (!displayStride || displayStride === 0) displayStride = run.avg_stride;

    // 心拍数の決定
    let displayHr = run.max_hr_5p;
    if (!displayHr || displayHr === 0) displayHr = run.hr_max;
    if (!displayHr || displayHr === 0) displayHr = run.avg_heart_rate;

    return {
      ...run,
      displayStride,
      displayHr,
      // ツールチップで「どのデータを使っているか」分かるようにフラグを持たせる
      isEstimated: !run.max_stride_5p
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
              {data.isEstimated && <span className="text-xs text-gray-400 ml-1">(Avg)</span>}
            </p>
            <p className="text-red-500">
              Heart Rate: <strong>{data.displayHr}</strong> bpm
              {data.isEstimated && <span className="text-xs text-gray-400 ml-1">(Avg)</span>}
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
        Max Metrics (Solid) / Avg Metrics (Fallback)
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
            name="Stride"
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
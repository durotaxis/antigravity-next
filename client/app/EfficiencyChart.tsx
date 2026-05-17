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
  startDate?: string | null;
};

export default function EfficiencyChart({ runs, startDate }: Props) {
  // 1. 日付順にソート
  const sortedRuns = [...runs].sort((a, b) =>
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // 2. startDate がある場合はフィルタリング
  const filteredRuns = startDate
    ? sortedRuns.filter(run => run.date >= startDate)
    : sortedRuns;

  // 3. 表示用データの加工 (MAX と AVG両方)
  const chartData = filteredRuns.map(run => {
    // Max values
    let maxHr = run.max_heart_rate || run.hr_max || run.avg_heart_rate || 0;
    let maxStride = run.max_stride || run.avg_stride || 0;

    // Avg values
    let avgHr = run.avg_heart_rate || 0;
    let avgStride = run.avg_stride || 0;

    // Apply Filters (Matching Old Screen Logic) - for Max values
    // 1. Invalid Stride > 300cm
    if (maxStride > 300) maxStride = 0;
    // 2. Invalid HR <= 100 or Missing (0) -> Invalidate Stride
    if (maxHr <= 100) maxStride = 0;

    // Apply filters for Avg values
    // 1. Invalid Avg Stride > 400cm (data anomaly filter)
    if (avgStride > 400) avgStride = 0;
    // 2. Invalid Avg HR <= 50 or > 200
    if (avgHr <= 50 || avgHr > 200) avgHr = 0;

    return {
      ...run,
      // Max values
      displayMaxStride: maxStride,
      displayMaxHr: maxHr,
      // Avg values
      displayAvgStride: avgStride,
      displayAvgHr: avgHr,
    };
  });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const year = d.getFullYear().toString().slice(-2);
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    return `${year}/${month}/${day}`;
  };

  // MAX チャート用ツールチップ
  const MaxTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded text-sm">
          <p className="font-bold text-gray-700 mb-1">{formatDate(data.date)}</p>
          <div className="space-y-1">
            <p className="text-blue-600">Stride: <strong>{data.displayMaxStride}</strong> cm</p>
            <p className="text-red-500">Heart Rate: <strong>{data.displayMaxHr}</strong> bpm</p>
          </div>
        </div>
      );
    }
    return null;
  };

  // AVG チャート用ツールチップ
  const AvgTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded text-sm">
          <p className="font-bold text-gray-700 mb-1">{formatDate(data.date)}</p>
          <div className="space-y-1">
            <p className="text-blue-400">Stride: <strong>{data.displayAvgStride.toFixed(1)}</strong> cm</p>
            <p className="text-red-400">Heart Rate: <strong>{data.displayAvgHr.toFixed(0)}</strong> bpm</p>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full bg-white rounded-lg shadow-sm">
      {/* MAX チャート */}
      <div className="p-4 border-b border-gray-100">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1 text-center">
            Max Performance
          </h2>
          <p className="text-xs text-center text-gray-400">
            Max Stride / Heart Rate
          </p>
        </div>

        <div style={{ width: '100%', height: '350px' }}>
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

              <Tooltip content={<MaxTooltip />} />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />

              {/* Max Stride Line */}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="displayMaxStride"
                name="Max Stride"
                stroke="#3b82f6"
                strokeWidth={3}
                dot={{ r: 4, strokeWidth: 2 }}
                activeDot={{ r: 6 }}
                connectNulls={true}
              />

              {/* Max Heart Rate Line */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="displayMaxHr"
                name="Max Heart Rate"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={true}
              />

            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* AVG チャート */}
      <div className="p-4">
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-1 text-center">
            Average Performance
          </h2>
          <p className="text-xs text-center text-gray-400">
            Avg Stride / Heart Rate
          </p>
        </div>

        <div style={{ width: '100%', height: '350px' }}>
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
                stroke="#60a5fa"
                domain={[0, 'auto']}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Stride (cm)', angle: -90, position: 'insideLeft', fill: '#60a5fa', fontSize: 10 }}
              />

              <YAxis
                yAxisId="right"
                orientation="right"
                stroke="#f87171"
                domain={[0, 'auto']}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Heart Rate (bpm)', angle: 90, position: 'insideRight', fill: '#f87171', fontSize: 10 }}
              />

              <Tooltip content={<AvgTooltip />} />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />

              {/* Avg Stride Line */}
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="displayAvgStride"
                name="Avg Stride"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={true}
              />

              {/* Avg Heart Rate Line */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="displayAvgHr"
                name="Avg Heart Rate"
                stroke="#f87171"
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls={true}
              />

            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

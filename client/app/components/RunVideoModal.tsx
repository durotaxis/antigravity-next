'use client';

import { useEffect, useRef, useState } from 'react';

type RoutePoint = {
  elapsedSeconds: number;
  latitude: number;
  longitude: number;
  distanceMeters: number | null;
  speed: number | null;
  heartRate: number | null;
  pitch: number | null;
};

type RouteRun = {
  runId: string;
  startTimeLabel: string;
  durationSeconds: number;
  points: RoutePoint[];
};

type Props = { date: string; apiBase: string; onClose: () => void };
type View = { zoom: number; centerX: number; centerY: number };

const WIDTH = 960;
const HEIGHT = 540;
const VIDEO_SECONDS = 45;
const TILE_SIZE = 256;

function worldPixel(longitude: number, latitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((Math.max(-85.0511, Math.min(85.0511, latitude)) * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

function computeView(points: RoutePoint[]): View {
  for (let zoom = 18; zoom >= 3; zoom -= 1) {
    const projected = points.map((p) => worldPixel(p.longitude, p.latitude, zoom));
    const xs = projected.map((p) => p.x);
    const ys = projected.map((p) => p.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    if (maxX - minX <= WIDTH - 120 && maxY - minY <= HEIGHT - 120) {
      return { zoom, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
    }
  }
  const first = worldPixel(points[0].longitude, points[0].latitude, 3);
  return { zoom: 3, centerX: first.x, centerY: first.y };
}

function formatElapsed(seconds: number) {
  const value = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export default function RunVideoModal({ date, apiBase, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const tileCacheRef = useRef(new Map<string, HTMLImageElement>());
  const [runs, setRuns] = useState<RouteRun[]>([]);
  const [runIndex, setRunIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [tileRevision, setTileRevision] = useState(0);
  const [error, setError] = useState('');

  const run = runs[runIndex];

  useEffect(() => {
    fetch(`${apiBase}/api/tcx-route/${date}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `API ${res.status}`);
        return json;
      })
      .then((json) => {
        const normalizedRuns = (Array.isArray(json.runs) ? json.runs : [])
          .map((item: RouteRun) => ({
            ...item,
            points: (Array.isArray(item.points) ? item.points : []).filter((point) => (
              point && Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude))
            )),
          }))
          .filter((item: RouteRun) => item.points.length > 0);
        setRuns(normalizedRuns);
        setRunIndex(0);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Route load failed'));
    return () => { if (animationRef.current !== null) cancelAnimationFrame(animationRef.current); };
  }, [apiBase, date]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !run || run.points.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const view = computeView(run.points);
    const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    const currentIndex = Math.max(0, Math.min(
      run.points.length - 1,
      Math.floor(safeProgress * (run.points.length - 1)),
    ));
    const toCanvas = (point: RoutePoint) => {
      const projected = worldPixel(point.longitude, point.latitude, view.zoom);
      return { x: projected.x - view.centerX + WIDTH / 2, y: projected.y - view.centerY + HEIGHT / 2 };
    };

    ctx.fillStyle = '#e8edf2'; ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const left = view.centerX - WIDTH / 2; const top = view.centerY - HEIGHT / 2;
    const minTileX = Math.floor(left / TILE_SIZE); const maxTileX = Math.floor((left + WIDTH) / TILE_SIZE);
    const minTileY = Math.floor(top / TILE_SIZE); const maxTileY = Math.floor((top + HEIGHT) / TILE_SIZE);
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
        const maxTile = 2 ** view.zoom;
        const wrappedX = ((tileX % maxTile) + maxTile) % maxTile;
        if (tileY < 0 || tileY >= maxTile) continue;
        const key = `${view.zoom}/${wrappedX}/${tileY}`;
        let image = tileCacheRef.current.get(key);
        if (!image) {
          image = new Image(); image.crossOrigin = 'anonymous';
          image.onload = () => setTileRevision((value) => value + 1);
          image.src = `https://tile.openstreetmap.org/${key}.png`;
          tileCacheRef.current.set(key, image);
        }
        if (image.complete && image.naturalWidth > 0) {
          ctx.drawImage(image, tileX * TILE_SIZE - left, tileY * TILE_SIZE - top, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    const drawRoute = (end: number, color: string, width: number) => {
      ctx.beginPath();
      run.points.slice(0, end + 1).forEach((point, index) => {
        const p = toCanvas(point); if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = width; ctx.strokeStyle = color; ctx.stroke();
    };
    drawRoute(run.points.length - 1, 'rgba(51,65,85,.45)', 7);
    drawRoute(currentIndex, '#f97316', 7);
    const current = run.points[currentIndex] || run.points[0];
    if (!current) return;
    const marker = toCanvas(current);
    ctx.beginPath(); ctx.arc(marker.x, marker.y, 8, 0, Math.PI * 2); ctx.fillStyle = '#2563eb'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();

    const drawOutlinedText = (text: string, x: number, y: number, color: string) => {
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,.92)';
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    ctx.font = '700 22px system-ui';
    drawOutlinedText(`${date}  ${run.startTimeLabel}`, 38, 51, '#fff');
    ctx.font = '600 17px system-ui';
    drawOutlinedText(`${formatElapsed(current.elapsedSeconds)}   ${((current.distanceMeters || 0) / 1000).toFixed(2)} km`, 38, 81, '#fff');
    drawOutlinedText(`HR ${current.heartRate ?? '-'} bpm`, 38, 108, '#fecaca');
    drawOutlinedText(`Speed ${current.speed?.toFixed(1) ?? '-'} km/h`, 175, 108, '#bfdbfe');
    ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.font = '12px system-ui'; ctx.fillText('© OpenStreetMap contributors', 755, 520);
  }, [date, progress, run, tileRevision]);

  const startPlayback = (fromStart = false, onEnd?: () => void) => {
    if (!run) return;
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    const initial = fromStart ? 0 : progress;
    const startedAt = performance.now() - initial * VIDEO_SECONDS * 1000;
    setPlaying(true); if (fromStart) setProgress(0);
    const tick = (now: number) => {
      const next = Math.min(1, (now - startedAt) / (VIDEO_SECONDS * 1000));
      setProgress(next);
      if (next < 1) animationRef.current = requestAnimationFrame(tick);
      else { setPlaying(false); animationRef.current = null; onEnd?.(); }
    };
    animationRef.current = requestAnimationFrame(tick);
  };

  const recordVideo = () => {
    const canvas = canvasRef.current;
    if (!canvas || !run || typeof MediaRecorder === 'undefined') return;
    const stream = canvas.captureStream(30);
    const preferred = 'video/webm;codecs=vp9';
    const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported(preferred) ? { mimeType: preferred } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data); };
    recorder.onstop = () => {
      const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
      const link = document.createElement('a'); link.href = url; link.download = `${run.runId}-run-video.webm`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000); setRecording(false);
    };
    recorder.start(1000); setRecording(true); startPlayback(true, () => recorder.stop());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div className="w-full max-w-5xl rounded-xl bg-slate-950 p-4 text-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-bold">Run Video</h2><p className="text-xs text-slate-400">45-second route replay</p></div>
          <button type="button" onClick={onClose} className="rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700">CLOSE</button>
        </div>
        {error ? <div className="rounded bg-red-950 p-4 text-red-200">{error}</div> : (
          <>
            <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} className="aspect-video w-full rounded-lg bg-slate-200" />
            <input aria-label="Video progress" type="range" min="0" max="1" step="0.001" value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="mt-3 w-full" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {runs.length > 1 && <select value={runIndex} onChange={(e) => { setRunIndex(Number(e.target.value)); setProgress(0); setPlaying(false); }} className="rounded bg-slate-800 px-3 py-2 text-sm">{runs.map((item, index) => <option value={index} key={item.runId}>{item.startTimeLabel || item.runId}</option>)}</select>}
              <button type="button" disabled={!run || playing} onClick={() => startPlayback(progress >= 1)} className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">PLAY</button>
              <button type="button" disabled={!run || recording || playing} onClick={recordVideo} className="rounded bg-orange-600 px-4 py-2 text-sm font-semibold disabled:opacity-50">{recording ? 'RECORDING…' : 'SAVE WEBM'}</button>
              <span className="ml-auto text-xs text-slate-400">Pitch {run?.points[Math.min((run?.points.length || 1) - 1, Math.floor(progress * ((run?.points.length || 1) - 1)))]?.pitch ?? '-'} spm</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

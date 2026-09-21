'use client';

import { useEffect, useRef, useState } from 'react';
import CorosImportNotifications from './CorosImportNotifications';
import type { ImportCompletionSnapshot } from '../../lib/corosImportNotifications';

type ImportStatus = ImportCompletionSnapshot & { enabled: boolean; running: boolean; intervalSeconds: number; lastError: string | null };

export default function CorosAutoImportControl({ apiBase, onImported }: { apiBase: string; onImported?: () => void }) {
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const completionSequence = useRef<number | null>(null);

  useEffect(() => {
    if (!status || !Number.isSafeInteger(status.completionSequence)) return;
    const previous = completionSequence.current;
    completionSequence.current = status.completionSequence;
    if (previous !== null && status.completionSequence > previous) onImported?.();
  }, [status, onImported]);

  useEffect(() => {
    const abort = new AbortController();
    let fetching = false;
    const load = async () => {
      if (fetching) return;
      fetching = true;
      const requestRevision = revision.current;
      try {
        const response = await fetch(`${apiBase}/api/coros-auto-import`, { cache: 'no-store', signal: abort.signal });
        if (!response.ok) throw new Error('FIT自動反映の状態を取得できませんでした。');
        const data: ImportStatus = await response.json();
        if (!abort.signal.aborted && requestRevision === revision.current) {
          setStatus(data);
          setError(null);
        }
      } catch {
        if (!abort.signal.aborted && requestRevision === revision.current) setError('FIT自動反映の状態を取得できませんでした。');
      } finally { fetching = false; }
    };
    if (!pending) void load();
    const timer = window.setInterval(() => { if (!pending) void load(); }, 10000);
    return () => { abort.abort(); window.clearInterval(timer); };
  }, [apiBase, pending]);

  const toggle = async () => {
    if (!status || pending) return;
    revision.current++;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/coros-auto-import`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !status.enabled })
      });
      if (!response.ok) throw new Error('save failed');
      setStatus(await response.json());
    } catch { setError('設定を保存できませんでした。状態を確認して、もう一度操作してください。'); }
    finally { setPending(false); }
  };

  return (
    <section aria-label="FIT自動反映" className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-gray-800">FIT自動反映</h2>
          <p className="mt-1 text-sm text-gray-600">取得済みのFITを30秒ごとに読み込み、RUNとコメントに反映します。</p>
        </div>
        <button type="button" role="switch" aria-checked={status?.enabled ?? false} aria-label="FIT自動反映"
          disabled={!status || pending} onClick={toggle}
          className={`inline-flex min-w-24 items-center justify-center gap-2 rounded-full px-4 py-2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-wait disabled:opacity-60 ${status?.enabled ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
          <span className={`h-3 w-3 rounded-full ${status?.enabled ? 'bg-white' : 'bg-gray-500'}`} aria-hidden="true" />
          {pending ? '保存中…' : !status ? '確認中…' : status.enabled ? 'ON' : 'OFF'}
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-600" aria-live="polite">
        {!status ? '設定を確認しています。' : status.running ? (status.enabled ? '反映処理中です。' : '停止を予約しました。処理中の分が完了すると停止します。') : status.enabled ? '自動反映はONです。' : '自動反映はOFFです。ONにするとすぐに確認します。'}
      </p>
      <p className="mt-1 text-xs text-gray-500">COROSからの新規RUN取得は、5分間隔で継続します。</p>
      {status?.lastError && <p className="mt-2 text-sm text-amber-700" role="status">{status.lastError}</p>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      <CorosImportNotifications apiBase={apiBase} snapshot={status} />
    </section>
  );
}

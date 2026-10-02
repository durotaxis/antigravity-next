'use client';

import { useCallback, useEffect, useState } from 'react';

type Status = { connected: boolean; running: boolean };
type Receipt = { imported: string[]; skipped: string[]; failed: { labelId: string; error: string }[] };

export default function CorosDirectReceive({ apiBase, onImported }: { apiBase: string; onImported: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [date, setDate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/coros-mcp`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '接続状態を取得できませんでした。');
      setStatus(data);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : '接続状態を取得できませんでした。'); }
  }, [apiBase]);
  useEffect(() => {
    setDate(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()));
    void load();
  }, [load]);
  const action = async (name: 'connect' | 'disconnect' | 'receive') => {
    if (pending) return;
    // Open before awaiting to preserve the browser's user-gesture permission.
    const popup = name === 'connect' ? window.open('about:blank', '_blank') : null;
    if (name === 'connect' && !popup) { setError('認証画面を開くため、ポップアップを許可してください。'); return; }
    if (popup) popup.opener = null;
    setPending(true);
    setError('');
    setReceipt(null);
    try {
      const response = await fetch(`${apiBase}/api/coros-mcp/${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'COROSの処理に失敗しました。');
      if (name === 'connect' && popup) popup.location.href = data.authorizationUrl;
      if (name === 'receive') { setReceipt(data); onImported(); }
      await load();
    } catch (e) { popup?.close(); setError(e instanceof Error ? e.message : 'COROSの処理に失敗しました。'); }
    finally { setPending(false); }
  };
  const disabled = pending || status?.running;
  const button = 'rounded border border-gray-300 px-3 py-2 text-sm font-semibold disabled:opacity-50';
  return (
    <section aria-label="COROS手動受信" className="mt-4 rounded-lg border border-blue-200 bg-white p-4">
      <h2 className="font-semibold text-gray-800">COROSから受信</h2>
      <p className="mt-1 text-sm text-gray-600">COROSアカウントを接続し、指定日のランを受信します。</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={button} disabled={disabled} onClick={() => void action('connect')}>
          {status?.connected ? 'COROSに再接続' : 'COROS接続'}
        </button>
        <button type="button" className={button} disabled={disabled} onClick={() => void load()}>接続状態を確認</button>
        {status?.connected && <button type="button" className={button} disabled={disabled} onClick={() => void action('disconnect')}>接続を解除</button>}
        <label className="text-sm text-gray-700">受信日 <input aria-label="COROS受信日" type="date" value={date} disabled={disabled}
          onChange={e => setDate(e.target.value)} className="rounded border p-2" /></label>
        <button type="button" disabled={disabled || !status?.connected || !date} onClick={() => void action('receive')}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? '処理中…' : '指定日のランを受信'}
        </button>
      </div>
      <p className="mt-2 text-sm text-gray-600" role="status">{status?.connected ? '接続済み' : '未接続'}{status?.running ? '・受信中' : ''}</p>
      {receipt && <div className="mt-2 text-sm" role="status">
        <p>反映 {receipt.imported.length}件・取得済み {receipt.skipped.length}件・失敗 {receipt.failed.length}件</p>
        {receipt.failed.map(item => <p key={item.labelId} className="text-red-700">{item.labelId}: {item.error}</p>)}
      </div>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </section>
  );
}

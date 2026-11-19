'use client';

import { useEffect, useState } from 'react';

export const receiveNotificationKey = (apiBase: string) => `coros-receive-push:${apiBase}`;

export default function CorosReceiveNotifications({ apiBase }: { apiBase: string }) {
  const [id, setId] = useState<string | null>(null);
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const key = receiveNotificationKey(apiBase);
  useEffect(() => {
    setAvailable(window.isSecureContext && 'Notification' in window && 'PushManager' in window && 'serviceWorker' in navigator);
    const refresh = () => {
      try { setId(localStorage.getItem(key)); }
      catch { setMessage('ブラウザーの保存設定を確認してください。'); }
    };
    refresh();
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [key]);

  const request = async (path: string, body?: object) => {
    const response = await fetch(`${apiBase}/api/coros-push${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '携帯通知を設定できませんでした。');
    return data;
  };
  const action = async (test = false) => {
    if (pending) return;
    setPending(true);
    setMessage('');
    try {
      if (test && id) {
        await request('/test', { id });
        setMessage('テスト通知を送信しました。端末で確認してください。');
      } else if (id) {
        await request('/unsubscribe', { id });
        localStorage.removeItem(key);
        setId(null);
      } else {
        // Permission must be requested directly from the button gesture.
        if (await Notification.requestPermission() !== 'granted') throw new Error('ブラウザーのサイト設定で通知を許可してください。');
        await navigator.serviceWorker.register('/coros-import-notifications-sw.js', { updateViaCache: 'none' });
        let timer: ReturnType<typeof setTimeout> | undefined;
        let registration: ServiceWorkerRegistration;
        try {
          registration = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('通知の準備がタイムアウトしました。')), 15000); }),
          ]);
        } finally { clearTimeout(timer); }
        const { publicKey } = await request('');
        const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        let subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const existing = subscription.options.applicationServerKey;
          if (!existing || new Uint8Array(existing).toString() !== bytes.toString()) {
            await subscription.unsubscribe();
            subscription = null;
          }
        }
        subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        const result = await request('/subscribe', { subscription: subscription.toJSON(), url: window.location.pathname + window.location.search });
        localStorage.setItem(key, result.id);
        setId(result.id);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : '通知を設定できませんでした。'); }
    finally { setPending(false); }
  };
  return <div className="mt-3 border-t border-gray-200 pt-3">
    <p className="text-sm font-medium">手動受信の携帯通知</p>
    <p className="mt-1 text-xs text-gray-600">この携帯で有効にすると、「指定日のランを受信」の結果を画面を閉じていても通知します。</p>
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={pending || (!available && !id)} onClick={() => void action()}
        className="rounded border border-gray-300 px-3 py-2 text-sm disabled:opacity-50">
        {pending ? '処理中…' : id ? '受信通知をOFFにする' : '受信通知を有効にする'}
      </button>
      <button type="button" disabled={pending || !id || !available} onClick={() => void action(true)}
        className="rounded border border-blue-300 px-3 py-2 text-sm disabled:opacity-50">受信のテスト通知</button>
    </div>
    {!available && <p className="mt-1 text-xs text-gray-600">HTTPSとWeb Push対応ブラウザーが必要です。iPhoneではホーム画面に追加したアプリから開いてください。</p>}
    {message && <p className="mt-2 text-sm text-amber-700" role="status">{message}</p>}
  </div>;
}

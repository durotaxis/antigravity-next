'use client';

import { useEffect, useState } from 'react';
import {
  deliverImportNotifications, deliverTestImportNotification, notificationStorageKey, readNotificationPreferences,
  setImportNotifications, type ImportCompletionSnapshot,
} from '../../lib/corosImportNotifications';

type WorkerState = 'checking' | 'ready' | 'missing' | 'error';

async function notificationRegistration() {
  const registration = await navigator.serviceWorker.register('/coros-import-notifications-sw.js', { updateViaCache: 'none' });
  if (registration.active) return registration;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('通知の準備がタイムアウトしました。')), 15000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export default function CorosImportNotifications({ apiBase, snapshot }: {
  apiBase: string; snapshot: ImportCompletionSnapshot | null;
}) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [availability, setAvailability] = useState<'checking' | 'available' | 'insecure' | 'unsupported'>('checking');
  const [pending, setPending] = useState(false);
  const [testPending, setTestPending] = useState(false);
  const [workerState, setWorkerState] = useState<WorkerState>('checking');
  const [cursor, setCursor] = useState<number | null>(null);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = notificationStorageKey(apiBase);

  useEffect(() => {
    const refresh = () => {
      setAvailability(!window.isSecureContext ? 'insecure' :
        !('Notification' in window) || !('serviceWorker' in navigator) ? 'unsupported' : 'available');
      if ('Notification' in window) setPermission(Notification.permission);
      try {
        const preferences = readNotificationPreferences(localStorage, key);
        setEnabled(preferences.enabled);
        setCursor(preferences.cursor);
      }
      catch { setError('通知設定を保存・読込できません。ブラウザーの保存設定を確認してください。'); }
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('storage', refresh); };
  }, [key]);

  useEffect(() => {
    if (availability !== 'available') return;
    let cancelled = false;
    void navigator.serviceWorker.getRegistration().then(registration => {
      if (!cancelled) setWorkerState(registration?.active ? 'ready' : 'missing');
    }).catch(() => {
      if (!cancelled) setWorkerState('error');
    });
    return () => { cancelled = true; };
  }, [availability, enabled]);

  useEffect(() => {
    if (!snapshot || !Array.isArray(snapshot.completions) || availability !== 'available' || permission !== 'granted' || !enabled) return;
    let cancelled = false;
    const deliver = async () => {
      const preferences = readNotificationPreferences(localStorage, key);
      if (cancelled || !preferences.enabled || preferences.cursor === snapshot.completionSequence) return;
      const registration = await notificationRegistration();
      if (cancelled) return;
      setWorkerState('ready');
      await deliverImportNotifications({
        snapshot, storage: localStorage, key,
        show: (title, options) => registration.showNotification(title, options),
        url: window.location.href,
      });
      if (!cancelled) {
        setCursor(readNotificationPreferences(localStorage, key).cursor);
        setError(null);
      }
    };
    const task = navigator.locks ? navigator.locks.request(key, deliver) : deliver();
    void task.catch(() => {
      if (!cancelled) setError('完了通知を表示できませんでした。次の確認時に再試行します。');
    });
    return () => { cancelled = true; };
  }, [snapshot, key, availability, permission, enabled]);

  const toggle = async () => {
    if (!snapshot || pending) return;
    setPending(true);
    setError(null);
    try {
      if (enabled && permission === 'granted') {
        setImportNotifications(localStorage, key, false, snapshot.completionSequence);
        setEnabled(false);
        setCursor(snapshot.completionSequence);
      } else {
        // Ask directly from this button gesture, never from a polling callback.
        const granted = await Notification.requestPermission();
        setPermission(granted);
        if (granted !== 'granted') return;
        await notificationRegistration();
        setWorkerState('ready');
        // Enabling notifications never announces historical imports.
        setImportNotifications(localStorage, key, true, snapshot.completionSequence);
        setEnabled(true);
        setCursor(snapshot.completionSequence);
      }
    } catch {
      setError('通知を有効にできませんでした。ブラウザーの通知・保存設定を確認してください。');
    } finally { setPending(false); }
  };

  const sendTestNotification = async () => {
    if (availability !== 'available' || permission !== 'granted' || !enabled || testPending) return;
    setTestPending(true);
    setTestStatus(null);
    setError(null);
    try {
      const registration = await notificationRegistration();
      setWorkerState('ready');
      await deliverTestImportNotification({
        show: (title, options) => registration.showNotification(title, options),
        url: window.location.href,
      });
      setTestStatus('ブラウザーがテスト通知を受け付けました。端末に表示されるか確認してください。');
    } catch {
      setWorkerState('error');
      setError('テスト通知を送れませんでした。Service WorkerまたはAndroidの通知設定を確認してください。');
    } finally { setTestPending(false); }
  };

  const permissionLabel = permission === 'granted' ? '許可' : permission === 'denied' ? '拒否' : '未確認';
  const workerLabel = workerState === 'ready' ? '準備完了' : workerState === 'missing' ? '未登録' : workerState === 'error' ? 'エラー' : '確認中';

  return (
    <div className="mt-3 border-t border-gray-200 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-700">取込完了の携帯通知</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={sendTestNotification}
            disabled={availability !== 'available' || permission !== 'granted' || !enabled || pending || testPending}
            className="rounded-md border border-blue-300 bg-blue-50 px-3 py-1.5 text-sm text-blue-800 disabled:opacity-50">
            {testPending ? '送信中…' : 'テスト通知を送る'}
          </button>
          <button type="button" onClick={toggle}
            disabled={availability !== 'available' || !snapshot || pending || testPending || permission === 'denied'}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 disabled:opacity-50">
            {pending ? '準備中…' : enabled && permission === 'granted' ? '完了通知をOFFにする' : '完了通知を有効にする'}
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-gray-600" aria-live="polite">
        {availability === 'insecure' ? '携帯通知を使うには、この画面をHTTPSで開いてください。' :
          availability === 'unsupported' ? 'このブラウザーは携帯通知に対応していません。' :
            permission === 'denied' ? 'ブラウザーのサイト設定で通知を許可してください。' :
              enabled && permission === 'granted' ? '通知ON：この画面を開いている間、RUNとコメントの保存完了を通知します。' :
                'この携帯で通知を許可すると、新しく取り込んだRUNの保存完了を通知します。'}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-gray-50 p-2 text-xs text-gray-700" aria-label="携帯通知の診断情報">
        <span>通知設定</span><strong>{enabled ? 'ON' : 'OFF'}</strong>
        <span>ブラウザー許可</span><strong>{permissionLabel}</strong>
        <span>Service Worker</span><strong>{workerLabel}</strong>
        <span>完了番号</span><strong>サーバー {snapshot?.completionSequence ?? '-'} / 端末 {cursor ?? '-'}</strong>
      </div>
      {testStatus && <p className="mt-2 text-sm text-blue-700" role="status">{testStatus}</p>}
      {error && <p className="mt-1 text-sm text-amber-700" role="status">{error}</p>}
    </div>
  );
}

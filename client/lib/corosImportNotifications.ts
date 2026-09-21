export type ImportCompletion = { sequence: number; date: string; runId: string; completedAt: string };
export type ImportCompletionSnapshot = { completionSequence: number; completions: ImportCompletion[] };
type Preferences = { enabled: boolean; cursor: number };
type StorageAccess = Pick<Storage, 'getItem' | 'setItem'>;

export const notificationStorageKey = (apiBase: string) => `coros-import-notifications:${apiBase}`;

export function readNotificationPreferences(storage: StorageAccess, key: string): Preferences {
  const raw = storage.getItem(key);
  if (!raw) return { enabled: false, cursor: 0 };
  const value = JSON.parse(raw);
  if (typeof value?.enabled !== 'boolean' || !Number.isSafeInteger(value.cursor) || value.cursor < 0) {
    throw new Error('通知設定を読み込めませんでした。');
  }
  return value;
}

export function setImportNotifications(storage: StorageAccess, key: string, enabled: boolean, cursor: number) {
  storage.setItem(key, JSON.stringify({ enabled, cursor }));
}

// Call under a Web Lock when available so tabs share one notification cursor.
export async function deliverImportNotifications({ snapshot, storage, key, show, url }: {
  snapshot: ImportCompletionSnapshot;
  storage: StorageAccess;
  key: string;
  show: (title: string, options: NotificationOptions) => Promise<void>;
  url: string;
}): Promise<number> {
  let count = 0;
  let preferences = readNotificationPreferences(storage, key);
  if (!preferences.enabled) return count;
  // A deliberately reset server journal starts a fresh baseline.
  if (preferences.cursor > snapshot.completionSequence) {
    setImportNotifications(storage, key, true, snapshot.completionSequence);
    return count;
  }
  for (const event of [...snapshot.completions].sort((a, b) => a.sequence - b.sequence)) {
    preferences = readNotificationPreferences(storage, key);
    if (!preferences.enabled) break;
    if (event.sequence <= preferences.cursor) continue;
    await show('COROSの取込が完了しました', {
      body: `${event.date} のRUNとコメントを保存しました。`,
      tag: `coros-import-${event.date}-${event.runId}`,
      data: { url },
    });
    // Persist only after the browser accepted the notification; failures can retry.
    const latest = readNotificationPreferences(storage, key);
    setImportNotifications(storage, key, latest.enabled, Math.max(latest.cursor, event.sequence));
    count++;
  }
  return count;
}

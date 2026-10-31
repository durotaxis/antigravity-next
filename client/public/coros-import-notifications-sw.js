// Notification delivery only; no fetch interception, cache or background polling.
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => { event.waitUntil(self.clients.claim()); });
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin);
    if (target.origin !== self.location.origin) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).pathname === target.pathname);
    if (existing) await existing.focus();
    else await self.clients.openWindow(target.href);
  })());
});

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const data = event.data ? event.data.json() : {};
    await self.registration.showNotification(data.title || 'COROSの受信結果', {
      body: data.body || 'アプリを開いて受信結果を確認してください。',
      tag: data.tag,
      data: { url: data.url || '/' },
    });
  })());
});

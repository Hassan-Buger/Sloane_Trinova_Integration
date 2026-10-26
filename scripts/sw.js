/*
 * Sloane's notification helper. It does one thing: show alerts on the device and open Sloane when
 * one is pressed. It does not cache pages or run anything in the background.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// A message pushed by the Sloane server, even when no Sloane page is open
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Sloane', {
    body: data.body || '',
    tag: data.tag || undefined,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    data: { view: data.view || 'command' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const view = event.notification.data && event.notification.data.view;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if ('focus' in client) {
        client.postMessage({ type: 'open-view', view });
        return client.focus();
      }
    }
    return self.clients.openWindow('/');
  })());
});

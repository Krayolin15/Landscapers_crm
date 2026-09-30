/* =============================================================================
   Service worker — makes Landscapers Inc. HQ open instantly and work offline.
   Vendored libraries, images, fonts: cache-first (they never change in place).
   App code (index.html, js/, css/) and the data pack: NETWORK-first with the
   cached copy as the offline fallback — so every deploy reaches every phone on
   its next load and modules from two different releases are never mixed.
   Supabase API calls are never cached here (the app keeps its own offline
   copy in IndexedDB and replays queued changes when back online).
   ========================================================================== */

const VERSION = 'lsihq-v1.2.0';
const IMMUTABLE = p => p.includes('/vendor/') || p.includes('/assets/');
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/tokens.css', './css/base.css', './css/animations.css', './css/layout.css', './css/components.css', './css/apps.css',
  './assets/landscapers-logo.jpg', './assets/icons/favicon.svg', './assets/icons/icon-192.png',
  './vendor/lucide.min.js', './vendor/supabase.min.js', './vendor/chart.umd.min.js', './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js', './vendor/xlsx.full.min.js', './vendor/jszip.min.js', './vendor/confetti.browser.min.js',
  './vendor/signature_pad.umd.min.js', './vendor/leaflet/leaflet.js', './vendor/leaflet/leaflet.css',
  './js/main.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL).catch(() => null)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('jit.si')) return;
  const keep = r => { if (r && r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); } return r; };
  if ((url.origin === location.origin && IMMUTABLE(url.pathname)) || url.hostname.includes('fonts.g')) {
    // cache-first
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(keep)));
    return;
  }
  if (url.origin === location.origin) {
    // network-first; offline -> last cached copy (navigation falls back to the app shell)
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(keep).catch(() => caches.match(e.request).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('./index.html') : undefined))));
  }
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(list => { const c = list[0]; if (c) { c.focus(); if (e.notification.data && e.notification.data.link) c.navigate(e.notification.data.link); } else self.clients.openWindow('./'); }));
});

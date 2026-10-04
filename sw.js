// Offline shell. App files are served cache-first and refreshed in the background,
// so the app opens instantly with no signal. Calls to Claude always go to the network.
const VERSION = 'vd-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/kinds.js', 'js/cues.js', 'js/model.js', 'js/director.js', 'js/recorder.js', 'js/store.js', 'js/voiceguard.js',
  'js/export/index.js', 'js/export/common.js', 'js/export/zip.js', 'js/export/docx.js', 'js/export/screenplay.js', 'js/export/text.js',
  'vendor/anthropic.mjs', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !fonts) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: sameOrigin });
    const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') cache.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

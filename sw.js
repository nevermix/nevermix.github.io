const CACHE_NAME = 'moze-lite-v11';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/data.js',
  './js/charts.js',
  './js/sync.js',
  './js/app.js',
  './js/telemetry.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

function isAppShellRequest(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return request.mode === 'navigate'
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('.js')
    || url.pathname.endsWith('.css')
    || url.pathname.endsWith('.json');
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  if (e.request.method !== 'GET') return;
  if (url.includes('gstatic.com') || url.includes('googleapis.com') || url.includes('firebaseio.com') || url.includes('firebaseapp.com') || url.includes('accounts.google.com') || url.includes('googleusercontent.com')) {
    return;
  }
  if (isAppShellRequest(e.request)) {
    e.respondWith(
      fetch(e.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, copy));
        return response;
      }).catch(() => {
        return caches.match(e.request).then(cached => cached || caches.match('./index.html'));
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});

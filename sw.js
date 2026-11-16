// Service worker: lets the installed Cecilia app open even when the local server isn't running.
//  - Cecilia's own files: network first (so edits show up), cached copy when offline.
//  - Libraries and the hand model from the CDNs: cached after the first load.
//  - Whisper models are cached by transformers.js itself.
const CACHE = 'cecilia-v1';
const APP = [
  '/', '/index.html', '/sketch.js', '/speech.js', '/hands.js', '/sound.js',
  '/manifest.webmanifest', '/favicon.png', '/icons/icon-192.png', '/icons/icon-512.png',
];
const CDN = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cecilia-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('/')))
    );
    return;
  }

  if (CDN.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }))
    );
  }
});

// Service worker : permet d'utiliser l'application hors connexion.
// Incrementer VERSION si la liste ASSETS change.
const VERSION = 'v1';
const CACHE = `score-logger-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/stats.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('score-logger-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Reseau d'abord (version a jour). Si pas de connexion, ou reseau trop lent (terrain),
// on sert la copie en cache apres 2,5 s ; le cache est quand meme mis a jour en arriere-plan.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const network = fetch(request).then((response) => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      });
      const cached = await cache.match(request, { ignoreSearch: true });
      if (!cached) return network.catch(() => cache.match('./index.html'));
      const slow = new Promise((resolve) => setTimeout(() => resolve(cached), 2500));
      return Promise.race([network.catch(() => cached), slow]);
    })(),
  );
});

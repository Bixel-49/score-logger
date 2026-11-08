// Service worker : permet d'utiliser l'application hors connexion.
// La version se change dans js/version.js (a chaque mise en ligne, ou si la liste ASSETS change).
importScripts('./js/version.js');
const VERSION = self.APP_VERSION;
const CACHE = `score-logger-${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/stats.js',
  './js/cloud.js',
  './js/firebase-config.js',
  './js/version.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];
// SDK Firebase : fichiers versionnes, jamais modifies -> cache d'abord
const SDK = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', (event) => {
  // cache: 'reload' : on telecharge vraiment les fichiers, sans reprendre une copie du cache HTTP
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  if (request.url.startsWith(SDK)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Les echanges avec Firebase (connexion, base de donnees) ne passent pas par le cache
  if (new URL(request.url).origin !== self.location.origin) return;

  // Reseau d'abord (version a jour). Si pas de connexion, ou reseau trop lent (terrain),
  // on sert la copie en cache apres 2,5 s ; le cache est quand meme mis a jour en arriere-plan.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // no-cache : le navigateur redemande toujours au serveur si le fichier a change
      const network = fetch(request, { cache: 'no-cache' }).then((response) => {
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

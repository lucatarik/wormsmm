const CACHE_NAME = 'worms-online-v4';
const STATIC_CACHE = 'worms-static-v4';

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/main.js',
  './js/utils/rng.js',
  './js/utils/terrain-gen.js',
  './js/scenes/BootScene.js',
  './js/scenes/MenuScene.js',
  './js/scenes/GameScene.js',
  './js/scenes/UIScene.js',
  './js/network/P2PSync.js',
  './js/network/PeerJSSync.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

const CDN_CACHE = 'worms-cdn-v4';
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/phaser@3.70.0/dist/phaser.min.js',
  'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
];

// Install: cache all static assets and CDN assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.addAll(STATIC_ASSETS).catch((err) => {
          console.warn('SW: Some static assets failed to cache:', err);
        });
      }),
      caches.open(CDN_CACHE).then((cache) => {
        return cache.addAll(CDN_ASSETS).catch((err) => {
          console.warn('SW: CDN assets failed to cache:', err);
        });
      }),
    ]).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  const validCaches = [STATIC_CACHE, CDN_CACHE, CACHE_NAME, 'worms-static-v3', 'worms-cdn-v3', 'worms-online-v3', 'worms-static-v2', 'worms-cdn-v2', 'worms-online-v2', 'worms-static-v1', 'worms-cdn-v1', 'worms-online-v1'];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => !validCaches.includes(name))
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: network-first for HTML, cache-first for assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests and WebSocket connections
  if (request.method !== 'GET') return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  // CDN assets: cache-first
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'unpkg.com') {
    event.respondWith(
      caches.open(CDN_CACHE).then((cache) => {
        return cache.match(request).then((cached) => {
          if (cached) return cached;
          return fetch(request).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        });
      })
    );
    return;
  }

  // HTML files: network-first
  if (request.headers.get('accept')?.includes('text/html') || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // JS/CSS/Images: cache-first with network fallback
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      }).catch(() => {
        // Return offline fallback for HTML
        if (request.headers.get('accept')?.includes('text/html')) {
          return caches.match('./index.html');
        }
      });
    })
  );
});

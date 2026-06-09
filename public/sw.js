const CACHE_VERSION = 'v1.0.0';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const EDIT_STATE_CACHE = `edit-state-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/gif.worker.js',
];

const CORE_ASSET_PATTERNS = [
  /\.(?:js|css|woff2?|ttf|eot)$/,
  /\/assets\//,
];

const IMAGE_PATTERNS = [
  /\.(?:png|jpe?g|gif|webp|svg|ico)$/i,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const staticCache = await caches.open(STATIC_CACHE);
      try {
        await staticCache.addAll(PRECACHE_URLS);
      } catch (err) {
        console.warn('[SW] Precache partial failure:', err);
        for (const url of PRECACHE_URLS) {
          try {
            await staticCache.add(url);
          } catch (e) {
            console.warn(`[SW] Failed to precache ${url}`);
          }
        }
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      const validCaches = new Set([STATIC_CACHE, RUNTIME_CACHE, EDIT_STATE_CACHE]);
      await Promise.all(
        cacheNames
          .filter((name) => !validCaches.has(name))
          .map((name) => caches.delete(name))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      return caches.match('/index.html');
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  if (CORE_ASSET_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  if (IMAGE_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;

    case 'CACHE_EDIT_STATE': {
      event.waitUntil(
        (async () => {
          const cache = await caches.open(EDIT_STATE_CACHE);
          const blob = new Blob([JSON.stringify(payload.state)], {
            type: 'application/json',
          });
          const response = new Response(blob, {
            headers: { 'Content-Type': 'application/json' },
          });
          await cache.put(`/edit-state/${payload.projectId || 'default'}`, response);
        })()
      );
      break;
    }

    case 'GET_EDIT_STATE': {
      event.waitUntil(
        (async () => {
          const cache = await caches.open(EDIT_STATE_CACHE);
          const response = await cache.match(`/edit-state/${payload.projectId || 'default'}`);
          if (response && event.source) {
            const state = await response.json();
            event.source.postMessage({ type: 'EDIT_STATE_RESTORED', payload: { state } });
          } else if (event.source) {
            event.source.postMessage({ type: 'EDIT_STATE_NOT_FOUND' });
          }
        })()
      );
      break;
    }

    case 'CLEAR_EDIT_STATE': {
      event.waitUntil(
        (async () => {
          const cache = await caches.open(EDIT_STATE_CACHE);
          await cache.delete(`/edit-state/${payload.projectId || 'default'}`);
        })()
      );
      break;
    }

    case 'CLEAR_RUNTIME_CACHE': {
      event.waitUntil(caches.delete(RUNTIME_CACHE));
      break;
    }

    case 'GET_CACHE_STATS': {
      event.waitUntil(
        (async () => {
          const stats = {};
          for (const name of [STATIC_CACHE, RUNTIME_CACHE, EDIT_STATE_CACHE]) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            stats[name] = keys.length;
          }
          if (event.source) {
            event.source.postMessage({ type: 'CACHE_STATS', payload: { stats } });
          }
        })()
      );
      break;
    }

    default:
      break;
  }
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-project-data') {
    event.waitUntil(
      (async () => {
        const clients = await self.clients.matchAll({ type: 'window' });
        for (const client of clients) {
          client.postMessage({ type: 'TRIGGER_SYNC' });
        }
      })()
    );
  }
});

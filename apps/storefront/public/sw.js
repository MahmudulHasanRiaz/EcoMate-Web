const CACHE_VERSION = 'v3';
const CACHE_NAMES = {
  pages: `ecomate-pages-${CACHE_VERSION}`,
  static: `ecomate-static-${CACHE_VERSION}`,
  images: `ecomate-images-${CACHE_VERSION}`,
};

const ALL_CACHES = Object.values(CACHE_NAMES);

const PRECACHE_ASSETS = [
  '/',
  '/favicon.svg',
  '/manifest.json',
  '/placeholder.svg',
];

const OFFLINE_IMAGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect fill="#f3f4f6" width="400" height="300"/><circle fill="#d1d5db" cx="200" cy="130" r="40"/><path fill="#d1d5db" d="M60 250 L140 180 L220 250 L300 160 L340 250 Z"/><text fill="#9ca3af" font-family="system-ui,sans-serif" font-size="14" text-anchor="middle" x="200" y="215">Image unavailable offline</text></svg>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAMES.static).then((cache) =>
      cache.addAll(PRECACHE_ASSETS)
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !ALL_CACHES.includes(k)).map((k) => caches.delete(k))
      );
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, CACHE_NAMES.pages));
    return;
  }

  if (
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(cacheFirst(request, CACHE_NAMES.static));
    return;
  }

  if (
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/assets/') ||
    request.destination === 'image' ||
    request.headers.get('Accept')?.includes('image/')
  ) {
    event.respondWith(imageFirst(request));
    return;
  }

  event.respondWith(networkFirst(request, CACHE_NAMES.pages));
});

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error('Offline');
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response(null, { status: 404 });
  }
}

async function imageFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAMES.images);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response(OFFLINE_IMAGE_SVG, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml' },
    });
  }
}

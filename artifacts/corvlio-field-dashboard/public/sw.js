const CACHE_PREFIX = 'corvlio-field-desk-';
const CACHE_NAME = `${CACHE_PREFIX}v6`;
const SCOPE_URL = new URL(self.registration.scope);
const OFFLINE_URL = new URL('./', SCOPE_URL).toString();
const APP_SHELL = [
  OFFLINE_URL,
  new URL('manifest.webmanifest', SCOPE_URL).toString(),
  new URL('logo.svg', SCOPE_URL).toString(),
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const responses = await Promise.all(
        APP_SHELL.map((url) => fetch(url, { cache: 'reload' })),
      );
      await Promise.all(
        responses.map((response, index) => {
          if (!response.ok) {
            throw new Error(`Unable to cache app shell: ${APP_SHELL[index]}`);
          }
          return cache.put(APP_SHELL[index], response);
        }),
      );
    }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== SCOPE_URL.origin || requestUrl.pathname.startsWith('/api')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then(async (response) => {
          if (response.ok) {
            const copy = response.clone();
            const cache = await caches.open(CACHE_NAME);
            await cache.put(OFFLINE_URL, copy);
          }
          return response;
        })
        .catch(async () => (await caches.match(OFFLINE_URL)) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(async (response) => {
        if (response.ok) {
          const copy = response.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, copy);
        }
        return response;
      })
      .catch(async () => (await caches.match(event.request)) ?? Response.error()),
  );
});
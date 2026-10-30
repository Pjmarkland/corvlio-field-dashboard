const CACHE_PREFIX = 'corvlio-field-desk-';
const CACHE_NAME = `${CACHE_PREFIX}v8`;
const SCOPE_URL = new URL(self.registration.scope);
const OFFLINE_URL = new URL('./', SCOPE_URL).toString();
const APP_SHELL = [
  OFFLINE_URL,
  new URL('manifest.webmanifest', SCOPE_URL).toString(),
  new URL('logo-dark.png', SCOPE_URL).toString(),
  new URL('logo-light.png', SCOPE_URL).toString(),
];

function isApiOrAuthRequest(request, requestUrl) {
  if (requestUrl.origin !== SCOPE_URL.origin) return true;
  if (request.headers.has('authorization')) return true;
  const path = requestUrl.pathname.toLowerCase();
  return path === '/api'
    || path.startsWith('/api/')
    || path.includes('/__clerk')
    || path.includes('/oauth')
    || /(^|\/)(sign-in|sign-up)(\/|$)/.test(path);
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data?.text() ?? '' };
  }

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title
    : 'New lead';
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    icon: new URL('logo-light.png', SCOPE_URL).toString(),
    badge: new URL('logo-light.png', SCOPE_URL).toString(),
    data: { deepLink: typeof payload.deepLink === 'string' ? payload.deepLink : '' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deepLink = event.notification.data?.deepLink;
  const target = new URL(typeof deepLink === 'string' ? deepLink.replace(/^\/+/, '') : '', SCOPE_URL);
  if (target.origin !== SCOPE_URL.origin || !target.pathname.startsWith(SCOPE_URL.pathname)) return;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if (!client.url.startsWith(SCOPE_URL.origin + SCOPE_URL.pathname)) continue;
        if ('navigate' in client) await client.navigate(target.toString());
        return client.focus();
      }
      return self.clients.openWindow(target.toString());
    }),
  );
});

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
  if (isApiOrAuthRequest(event.request, requestUrl)) return;

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
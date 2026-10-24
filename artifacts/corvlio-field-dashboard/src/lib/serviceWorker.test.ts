import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

type WorkerEventHandler = (event: any) => void;

function loadWorker() {
  const handlers = new Map<string, WorkerEventHandler>();
  const scope = 'https://app.test/corvlio-field-dashboard/';
  const selfMock = {
    registration: {
      scope,
      showNotification: vi.fn().mockResolvedValue(undefined),
    },
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
      matchAll: vi.fn().mockResolvedValue([]),
      openWindow: vi.fn().mockResolvedValue(undefined),
    },
    addEventListener: vi.fn((name: string, handler: WorkerEventHandler) => handlers.set(name, handler)),
    skipWaiting: vi.fn().mockResolvedValue(undefined),
  };
  const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
  const fakeCaches = { open: vi.fn(), keys: vi.fn(), delete: vi.fn(), match: vi.fn() };
  new Function('self', 'caches', 'URL', 'Response', 'fetch', source)(
    selfMock,
    fakeCaches,
    URL,
    Response,
    fetch,
  );
  return { handlers, selfMock, scope };
}

describe('field dashboard service worker', () => {
  it('does not intercept API, Clerk, or sign-in requests for caching', () => {
    const { handlers } = loadWorker();
    const fetchHandler = handlers.get('fetch')!;
    for (const url of [
      'https://app.test/api/leads',
      'https://app.test/api/__clerk/v1/client',
      'https://app.test/corvlio-field-dashboard/sign-in',
      'https://app.test/corvlio-field-dashboard/sign-up',
    ]) {
      const respondWith = vi.fn();
      fetchHandler({
        request: { method: 'GET', url, headers: new Headers(), mode: url.includes('sign-in') || url.includes('sign-up') ? 'navigate' : 'cors' },
        respondWith,
      });
      expect(respondWith).not.toHaveBeenCalled();
    }
  });

  it('shows a push and opens only a same-origin route inside the app scope on click', async () => {
    const { handlers, selfMock, scope } = loadWorker();
    let shown!: Promise<unknown>;
    handlers.get('push')!({
      data: { json: () => ({ title: 'New lead', body: 'Heating repair', deepLink: '/leads/33' }) },
      waitUntil: (promise: Promise<unknown>) => { shown = promise; },
    });
    await shown;
    expect(selfMock.registration.showNotification).toHaveBeenCalledWith(
      'New lead',
      expect.objectContaining({ body: 'Heating repair', data: { deepLink: '/leads/33' } }),
    );

    let opened!: Promise<unknown>;
    handlers.get('notificationclick')!({
      notification: { data: { deepLink: '/leads/33' }, close: vi.fn() },
      waitUntil: (promise: Promise<unknown>) => { opened = promise; },
    });
    await opened;
    expect(selfMock.clients.openWindow).toHaveBeenCalledWith(`${scope}leads/33`);
  });

  it('bumps the shell cache when the service worker changes', () => {
    const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    expect(source).toMatch(/const CACHE_NAME = `\$\{CACHE_PREFIX\}v8`;/);
  });
});

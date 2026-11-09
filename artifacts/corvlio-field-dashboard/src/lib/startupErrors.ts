type ErrorSource = 'window.error' | 'unhandledrejection';

export type StartupError = { error: Error; source: ErrorSource };

let lastError: StartupError | null = null;
const listeners = new Set<() => void>();

export function normalizeStartupError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (reason && typeof reason === 'object' && 'message' in reason) {
    const details = reason as { name?: unknown; message: unknown; stack?: unknown };
    const error = new Error(String(details.message));
    if (typeof details.name === 'string') error.name = details.name;
    if (typeof details.stack === 'string') error.stack = details.stack;
    return error;
  }
  let message: string;
  try {
    message = typeof reason === 'string' ? reason : JSON.stringify(reason) ?? String(reason);
  } catch {
    message = String(reason);
  }
  return new Error(message);
}

export function recordStartupError(reason: unknown, source: ErrorSource): void {
  const error = normalizeStartupError(reason);
  lastError = { error, source };
  console.error(`[Corvlio ${source}] ${error.name}: ${error.message}`, error.stack, error);
  listeners.forEach((listener) => listener());
}

export const getLastStartupError = (): StartupError | null => lastError;

export function subscribeStartupErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// The first import in main.tsx installs these before the native fetch bridge
// and before React loads the application. Keep diagnostics in memory only.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event: ErrorEvent) => {
    const error = event.error
      ? normalizeStartupError(event.error)
      : new Error(event.message || 'Uncaught JavaScript error');
    if (!event.error && event.filename) {
      error.stack = `${error.name}: ${error.message}\n    at ${event.filename}:${event.lineno}:${event.colno}`;
    }
    recordStartupError(error, 'window.error');
  });
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    recordStartupError(event.reason, 'unhandledrejection');
  });
}

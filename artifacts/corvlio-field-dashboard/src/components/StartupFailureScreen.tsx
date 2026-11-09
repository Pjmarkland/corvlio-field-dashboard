import { useEffect, useSyncExternalStore } from 'react';
import { getAppBuildInfo } from '@/lib/buildInfo';
import { getLastStartupError, subscribeStartupErrors } from '@/lib/startupErrors';

interface StartupFailureScreenProps {
  error?: Error;
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export function StartupFailureScreen({
  error,
  title = 'Corvlio couldn’t start',
  message = 'Check your connection and try again. If the problem continues, contact support.',
  onRetry,
}: StartupFailureScreenProps) {
  const lastGlobalError = useSyncExternalStore(subscribeStartupErrors, getLastStartupError, getLastStartupError);
  const primaryError = error ?? lastGlobalError?.error;
  useEffect(() => {
    if (primaryError) {
      console.error(`[Corvlio startup failure] ${primaryError.name}: ${primaryError.message}`, primaryError.stack, primaryError);
    }
  }, [primaryError]);
  const diagnostics = (value: Error) => (
    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/25 bg-black/25 p-3 text-left font-mono text-xs leading-relaxed text-white/90">
      {`${value.name}: ${value.message}\n${value.stack?.split('\n').slice(0, 6).join('\n') ?? 'Stack trace unavailable'}`}
    </pre>
  );
  return (
    <main
      role="alert"
      className="flex min-h-[100dvh] items-center justify-center bg-[#071527] px-6 text-center text-white"
    >
      <div className="w-full min-w-0 max-w-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-white/75">{message}</p>
        {primaryError ? diagnostics(primaryError) : null}
        {lastGlobalError ? (
          <div className="mt-3 text-left">
            <p className="text-xs text-white/75">Last global error: {lastGlobalError.source}</p>
            {lastGlobalError.error !== primaryError ? diagnostics(lastGlobalError.error) : null}
          </div>
        ) : null}
        <p className="mt-3 text-xs text-white/55">{getAppBuildInfo()}</p>
        <button
          type="button"
          onClick={onRetry ?? (() => window.location.reload())}
          className="mt-5 min-h-11 rounded-xl bg-white px-5 text-sm font-semibold text-[#071527]"
        >
          Retry
        </button>
      </div>
    </main>
  );
}

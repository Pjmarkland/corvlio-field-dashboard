import { getAppBuildInfo } from '@/lib/buildInfo';

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
  return (
    <main
      role="alert"
      className="flex min-h-[100dvh] items-center justify-center bg-[#071527] px-6 text-center text-white"
    >
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-white/75">{message}</p>
        {import.meta.env.DEV && error ? (
          <p className="mt-2 break-words text-xs text-white/55">{error.message}</p>
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

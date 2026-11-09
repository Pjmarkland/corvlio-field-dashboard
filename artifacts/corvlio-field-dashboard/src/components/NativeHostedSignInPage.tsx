import { useEffect, useState } from 'react';
import { SignIn, SignUp } from '@clerk/react';
import { useLocation } from 'wouter';
import { useAppAuth } from '@/auth/AppAuthProvider';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
// The Clerk runtime supports virtual routing, but SignIn/SignUp's current
// component typings only expose path and hash routing.
const nativeFallbackRouting = 'virtual' as never;

export function NativeHostedSignInPage({ mode }: { mode: 'signIn' | 'signUp' }) {
  const {
    isLoaded,
    isSignedIn,
    error,
    authMode,
    nativeFallbackReason,
    startHostedAuth,
  } = useAppAuth();
  const [, setLocation] = useLocation();
  const [busy, setBusy] = useState(false);
  const isSignUp = mode === 'signUp';

  const continueToApp = () => setLocation(isSignUp ? '/welcome' : '/dashboard');
  useEffect(() => {
    if (isLoaded && isSignedIn) continueToApp();
  }, [isLoaded, isSignedIn]);

  const start = async () => {
    setBusy(true);
    try {
      await startHostedAuth(mode);
      continueToApp();
    } catch {
      // Cancellation and Clerk errors are presented by the auth provider.
    } finally {
      setBusy(false);
    }
  };

  if (isLoaded && isSignedIn) return null;

  if (authMode === 'web-fallback') {
    return (
      <main className="min-h-[100dvh] bg-background px-4 py-8 text-foreground">
        <div className="mx-auto mb-5 max-w-md">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
            Clerk in-app sign-in fallback
          </p>
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            Native sign-in did not respond. Continue with your Corvlio email and password.
          </p>
          {nativeFallbackReason ? (
            <details className="mt-3 rounded-xl border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold">Native diagnostic trace</summary>
              <p className="mt-2 break-words">{nativeFallbackReason}</p>
            </details>
          ) : null}
          {error ? <p role="alert" className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p> : null}
        </div>
        <div className="flex justify-center">
          {isSignUp ? (
            <SignUp
              routing={nativeFallbackRouting}
              signInUrl={`${basePath}/sign-in`}
              forceRedirectUrl={`${basePath}/welcome`}
            />
          ) : (
            <SignIn
              routing={nativeFallbackRouting}
              signUpUrl={`${basePath}/sign-up`}
              forceRedirectUrl={`${basePath}/dashboard`}
            />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5 py-8 text-foreground">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <img src="/logo-dark.png" alt="Corvlio" className="mb-7 h-10 w-auto dark:hidden" />
        <img src="/logo-light.png" alt="Corvlio" className="mb-7 hidden h-10 w-auto dark:block" />
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Corvlio Field Desk</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          {isSignUp ? 'Create your owner account' : 'Welcome back'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Sign in securely through Clerk. Your session returns to this app and is stored securely on this device.
        </p>
        {error ? <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm">{error}</p> : null}
        <button
          type="button"
          onClick={() => void start()}
          disabled={!isLoaded || busy}
          data-testid="button-native-clerk-hosted-auth"
          className="mt-6 min-h-12 w-full rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground disabled:opacity-60"
        >
          {busy ? 'Connecting securely…' : isSignUp ? 'Continue to sign up' : 'Continue to sign in'}
        </button>
        <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
          Clerk opens a secure system authentication session. Your password is never entered into the app’s WebView.
        </p>
      </section>
    </main>
  );
}

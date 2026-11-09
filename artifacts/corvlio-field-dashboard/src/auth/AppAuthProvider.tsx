import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth, useClerk, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import {
  getNativeClerkToken,
  nativeClerkAuth,
  type NativeClerkAuthState,
  type NativeClerkUser,
} from './nativeClerkAuth';

const USE_NATIVE_CLERK = false;

export type AppAuthUser = {
  id: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: string | null;
  emailAddresses: Array<{ emailAddress: string }>;
};

export type AppAuthValue = {
  user: AppAuthUser | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  error: string | null;
  authMode: 'web' | 'native' | 'web-fallback';
  signOut: () => Promise<void>;
  startHostedAuth: (mode: 'signIn' | 'signUp') => Promise<void>;
};

const signedOut: AppAuthValue = {
  user: null,
  isLoaded: true,
  isSignedIn: false,
  error: null,
  authMode: 'web',
  signOut: async () => {},
  startHostedAuth: async () => {
    throw new Error('Native sign-in is unavailable.');
  },
};

const AppAuthContext = createContext<AppAuthValue>(signedOut);

export function useAppAuth(): AppAuthValue {
  return useContext(AppAuthContext);
}

export function WebAppAuthProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const value = useMemo<AppAuthValue>(() => ({
    user: user ? {
      id: user.id,
      fullName: user.fullName,
      firstName: user.firstName,
      lastName: user.lastName,
      primaryEmailAddress: user.primaryEmailAddress?.emailAddress ?? null,
      emailAddresses: user.emailAddresses.map(({ emailAddress }) => ({ emailAddress })),
    } : null,
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
    error: null,
    authMode: 'web',
    signOut: async () => { await signOut(); },
    startHostedAuth: async () => {
      throw new Error('Hosted native authentication is only available in the iOS app.');
    },
  }), [isLoaded, isSignedIn, signOut, user]);

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

function normalizeNativeUser(user: NativeClerkUser | null): AppAuthUser | null {
  if (!user) return null;
  return {
    id: user.id,
    fullName: user.fullName,
    firstName: user.firstName,
    lastName: user.lastName,
    primaryEmailAddress: user.primaryEmailAddress,
    emailAddresses: user.emailAddresses,
  };
}

export function NativeAppAuthProvider({
  children,
  publishableKey,
}: {
  children: ReactNode;
  publishableKey: string;
}) {
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const { user: webUser, isLoaded: isWebAuthLoaded, isSignedIn: isWebSignedIn } = useUser();
  const { signOut: webSignOut } = useClerk();
  const [authState, setAuthState] = useState<NativeClerkAuthState>({
    isSignedIn: false,
    user: null,
  });
  const [nativeIsLoaded, setNativeIsLoaded] = useState(false);
  const [fallbackMode, setFallbackMode] = useState(!USE_NATIVE_CLERK);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const previousUserId = useRef<string | null | undefined>(undefined);

  const applyState = useCallback((next: NativeClerkAuthState) => {
    const nextUserId = next.user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
      queryClient.clear();
    }
    previousUserId.current = nextUserId;
    setAuthState(next);
  }, [queryClient]);

  const activateWebFallback = useCallback((reason: unknown) => {
    const diagnostic = reason instanceof Error
      ? reason.message
      : 'Unknown native authentication error.';
    console.warn('[Corvlio auth] Native authentication failed; using Clerk web auth.', diagnostic);
    setAuthTokenGetter(() => getToken());
    setFallbackError(null);
    setFallbackMode(true);
  }, [getToken]);

  useEffect(() => {
    let mounted = true;
    if (!USE_NATIVE_CLERK) {
      console.info('[Corvlio auth] USE_NATIVE_CLERK=false; using the in-app Clerk form.');
      setAuthTokenGetter(() => getToken());
      return () => { mounted = false; };
    }

    setAuthTokenGetter(getNativeClerkToken);
    void (async () => {
      try {
        await nativeClerkAuth.initialize({
          publishableKey,
          redirectUrl: 'com.corvlio.fielddashboard://callback',
          callbackUrlScheme: 'com.corvlio.fielddashboard',
        });
        const state = await nativeClerkAuth.getAuthState();
        if (!mounted) return;
        applyState(state);
        setNativeIsLoaded(true);
      } catch (reason) {
        if (!mounted) return;
        activateWebFallback(reason);
      }
    })();
    return () => { mounted = false; };
  }, [activateWebFallback, applyState, getToken, publishableKey]);

  useEffect(() => {
    if (!fallbackMode || isWebAuthLoaded) {
      setFallbackError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const message = 'Sign-in is taking longer than expected. Check your connection and try again.';
      console.warn('[Corvlio auth] Clerk web sign-in did not finish loading.');
      setFallbackError(message);
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [fallbackMode, isWebAuthLoaded]);

  useEffect(() => {
    if (!fallbackMode) return;
    const nextUserId = webUser?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
      queryClient.clear();
    }
    previousUserId.current = nextUserId;
  }, [fallbackMode, queryClient, webUser?.id]);

  const signOut = useCallback(async () => {
    if (fallbackMode) {
      await webSignOut();
      return;
    }
    const state = await nativeClerkAuth.signOut();
    applyState(state);
  }, [applyState, fallbackMode, webSignOut]);

  const startHostedAuth = useCallback(async (mode: 'signIn' | 'signUp') => {
    if (fallbackMode) {
      throw new Error('Use the Clerk sign-in form to continue.');
    }
    try {
      const state = await nativeClerkAuth.startHostedAuth({ mode });
      applyState(state);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Sign-in was not completed.';
      if (!/cancel|dismiss/i.test(message)) await activateWebFallback(reason);
      throw reason;
    }
  }, [activateWebFallback, applyState, fallbackMode]);

  const webAuthUser = webUser ? {
    id: webUser.id,
    fullName: webUser.fullName,
    firstName: webUser.firstName,
    lastName: webUser.lastName,
    primaryEmailAddress: webUser.primaryEmailAddress?.emailAddress ?? null,
    emailAddresses: webUser.emailAddresses.map(({ emailAddress }) => ({ emailAddress })),
  } : null;
  const isLoaded = fallbackMode ? isWebAuthLoaded : nativeIsLoaded;
  const isSignedIn = fallbackMode ? Boolean(isWebSignedIn) : authState.isSignedIn;
  const error = fallbackMode ? fallbackError : null;
  const value = useMemo<AppAuthValue>(() => ({
    user: fallbackMode ? webAuthUser : normalizeNativeUser(authState.user),
    isLoaded,
    isSignedIn,
    error,
    authMode: fallbackMode ? 'web-fallback' : 'native',
    signOut,
    startHostedAuth,
  }), [
    authState,
    error,
    fallbackMode,
    isLoaded,
    isSignedIn,
    signOut,
    startHostedAuth,
    webAuthUser,
  ]);

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

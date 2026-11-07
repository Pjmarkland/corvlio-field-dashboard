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
import { useClerk, useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  nativeClerkAuth,
  type NativeClerkAuthState,
  type NativeClerkUser,
} from './nativeClerkAuth';

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
  signOut: () => Promise<void>;
  startHostedAuth: (mode: 'signIn' | 'signUp') => Promise<void>;
};

const signedOut: AppAuthValue = {
  user: null,
  isLoaded: true,
  isSignedIn: false,
  error: null,
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
  const [authState, setAuthState] = useState<NativeClerkAuthState>({
    isSignedIn: false,
    user: null,
  });
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousUserId = useRef<string | null | undefined>(undefined);

  const applyState = useCallback((next: NativeClerkAuthState) => {
    const nextUserId = next.user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== nextUserId) {
      queryClient.clear();
    }
    previousUserId.current = nextUserId;
    setAuthState(next);
    setError(null);
  }, [queryClient]);

  useEffect(() => {
    let mounted = true;
    void nativeClerkAuth.initialize({
      publishableKey,
      redirectUrl: 'com.corvlio.fielddashboard://callback',
      callbackUrlScheme: 'com.corvlio.fielddashboard',
    }).then((state) => {
      if (!mounted) return;
      applyState(state);
      setIsLoaded(true);
    }).catch((reason: unknown) => {
      if (!mounted) return;
      setError(reason instanceof Error ? reason.message : 'Clerk could not initialize native sign-in.');
      setIsLoaded(true);
    });
    return () => { mounted = false; };
  }, [applyState, publishableKey]);

  const signOut = useCallback(async () => {
    const state = await nativeClerkAuth.signOut();
    applyState(state);
  }, [applyState]);

  const startHostedAuth = useCallback(async (mode: 'signIn' | 'signUp') => {
    setError(null);
    try {
      const state = await nativeClerkAuth.startHostedAuth({ mode });
      applyState(state);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Sign-in was not completed.';
      if (!/cancel|dismiss/i.test(message)) setError(message);
      throw reason;
    }
  }, [applyState]);

  const value = useMemo<AppAuthValue>(() => ({
    user: normalizeNativeUser(authState.user),
    isLoaded,
    isSignedIn: authState.isSignedIn,
    error,
    signOut,
    startHostedAuth,
  }), [authState, error, isLoaded, signOut, startHostedAuth]);

  return <AppAuthContext.Provider value={value}>{children}</AppAuthContext.Provider>;
}

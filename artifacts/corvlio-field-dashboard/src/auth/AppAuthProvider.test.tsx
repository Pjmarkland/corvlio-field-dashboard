import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getAuthState: vi.fn(),
  getDebugTrace: vi.fn(),
  startHostedAuth: vi.fn(),
  getToken: vi.fn(),
  webGetToken: vi.fn(),
  signOut: vi.fn(),
  webAuth: {
    user: null as null | {
      id: string;
      fullName: string | null;
      firstName: string | null;
      lastName: string | null;
      primaryEmailAddress: { emailAddress: string } | null;
      emailAddresses: Array<{ emailAddress: string }>;
    },
    isLoaded: true,
    isSignedIn: false,
  },
  setAuthTokenGetter: vi.fn(),
}));

vi.mock('./nativeClerkAuth', () => ({
  nativeClerkAuth: mocks,
  getNativeClerkToken: async () => (await mocks.getToken()).token,
  getNativeClerkFailureMessage: async (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : 'Native sign-in could not start.';
    const trace = await mocks.getDebugTrace();
    return `${message} Last native step: ${trace.lastStep}.`;
  },
}));
vi.mock('@clerk/react', async () => {
  const React = await import('react');
  return {
    useAuth: () => ({ getToken: mocks.webGetToken }),
    useUser: () => mocks.webAuth,
    useClerk: () => ({ signOut: mocks.signOut }),
    SignIn: () => React.createElement('div', { 'data-testid': 'clerk-fallback-sign-in' }, 'Clerk email/password sign-in'),
    SignUp: () => React.createElement('div', { 'data-testid': 'clerk-fallback-sign-up' }, 'Clerk email/password sign-up'),
  };
});
vi.mock('@workspace/api-client-react', () => ({
  setAuthTokenGetter: mocks.setAuthTokenGetter,
}));

import { NativeAppAuthProvider, useAppAuth } from './AppAuthProvider';
import { NativeHostedSignInPage } from '@/components/NativeHostedSignInPage';

const signedOutState = { isSignedIn: false, user: null };
const signedInState = {
  isSignedIn: true,
  user: {
    id: 'user_native_test',
    fullName: 'Native Test',
    firstName: 'Native',
    lastName: 'Test',
    primaryEmailAddress: 'native@example.test',
    emailAddresses: [{ emailAddress: 'native@example.test' }],
  },
};

function AuthProbe() {
  const { isLoaded, isSignedIn, user, signOut, authMode, nativeFallbackReason } = useAppAuth();
  return (
    <div>
      <p data-testid="native-auth-state">
        {isLoaded ? (isSignedIn ? `signed-in:${user?.id}` : 'signed-out') : 'loading'}
      </p>
      <p data-testid="native-auth-mode">{authMode}</p>
      <p data-testid="native-fallback-reason">{nativeFallbackReason}</p>
      <button type="button" onClick={() => void signOut()}>Sign out in test</button>
    </div>
  );
}

function renderNative(children: React.ReactNode, startPath = '/sign-in') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const location = memoryLocation({ path: startPath });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <NativeAppAuthProvider publishableKey="pk_test_native-test">
          <Router hook={location.hook}>
            {children}
          </Router>
        </NativeAppAuthProvider>
      </QueryClientProvider>,
    ),
    location,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.initialize.mockResolvedValue(signedOutState);
  mocks.getAuthState.mockResolvedValue(signedOutState);
  mocks.getDebugTrace.mockResolvedValue({ lastStep: 'initialize called' });
  mocks.startHostedAuth.mockResolvedValue(signedInState);
  mocks.getToken.mockResolvedValue({ token: 'session-token-test' });
  mocks.webGetToken.mockResolvedValue('session-token-test');
  mocks.signOut.mockResolvedValue(signedOutState);
  mocks.webAuth = { user: null, isLoaded: true, isSignedIn: false };
});

describe('native Clerk hosted authentication', () => {
  it('initializes the registered key and enters the dashboard after hosted sign-in', async () => {
    renderNative(
      <Switch>
        <Route path="/sign-in">
          <NativeHostedSignInPage mode="signIn" />
        </Route>
        <Route path="/dashboard">Native dashboard</Route>
      </Switch>,
    );

    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledWith({
      publishableKey: 'pk_test_native-test',
      redirectUrl: 'com.corvlio.fielddashboard://callback',
      callbackUrlScheme: 'com.corvlio.fielddashboard',
    }));
    fireEvent.click(await screen.findByTestId('button-native-clerk-hosted-auth'));
    expect(await screen.findByText('Native dashboard')).toBeTruthy();
    expect(mocks.startHostedAuth).toHaveBeenCalledWith({ mode: 'signIn' });
  });

  it('loads Keychain state separately and forwards sign-out', async () => {
    mocks.getAuthState.mockResolvedValue(signedInState);
    renderNative(<AuthProbe />, '/dashboard');

    expect((await screen.findByTestId('native-auth-state')).textContent).toContain('signed-in:user_native_test');
    fireEvent.click(screen.getByText('Sign out in test'));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('native-auth-state').textContent).toContain('signed-out'));
  });

  it('automatically shows Clerk email/password sign-in after native initialization fails', async () => {
    mocks.initialize.mockRejectedValue(new Error('Native configure did not respond.'));
    renderNative(
      <>
        <AuthProbe />
        <Switch>
          <Route path="/sign-in"><NativeHostedSignInPage mode="signIn" /></Route>
          <Route path="/dashboard">Native dashboard</Route>
        </Switch>
      </>,
    );

    expect(await screen.findByTestId('clerk-fallback-sign-in')).toBeTruthy();
    expect(screen.getByTestId('native-auth-mode').textContent).toBe('web-fallback');
    expect(screen.getByTestId('native-fallback-reason').textContent)
      .toBe('Native configure did not respond. Last native step: initialize called.');
    expect(screen.getByText(/Continue with your Corvlio email and password/)).toBeTruthy();

    const tokenGetter = mocks.setAuthTokenGetter.mock.calls.at(-1)?.[0] as (() => Promise<string | null>) | undefined;
    expect(tokenGetter).toBeTypeOf('function');
    await expect(tokenGetter?.()).resolves.toBe('session-token-test');
  });
});

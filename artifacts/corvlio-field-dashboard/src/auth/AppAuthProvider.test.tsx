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
  signInProps: vi.fn(),
  signUpProps: vi.fn(),
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
    SignIn: (props: Record<string, unknown>) => {
      mocks.signInProps(props);
      return React.createElement('div', { 'data-testid': 'clerk-fallback-sign-in' }, 'Clerk email/password sign-in');
    },
    SignUp: (props: Record<string, unknown>) => {
      mocks.signUpProps(props);
      return React.createElement('div', { 'data-testid': 'clerk-fallback-sign-up' }, 'Clerk email/password sign-up');
    },
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
  const location = memoryLocation({ path: startPath, record: true });
  const wrap = (content: React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <NativeAppAuthProvider publishableKey="pk_test_native-test">
        <Router hook={location.hook}>
          {content}
        </Router>
      </NativeAppAuthProvider>
    </QueryClientProvider>
  );
  const result = render(wrap(children));
  return {
    ...result,
    rerenderNative: (content: React.ReactNode) => result.rerender(wrap(content)),
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
    const routes = (
      <Switch>
        <Route path="/"><div data-testid="public-home">Public homepage</div></Route>
        <Route path="/sign-in">
          <>
            <AuthProbe />
            <NativeHostedSignInPage mode="signIn" />
          </>
        </Route>
        <Route path="/dashboard">Native dashboard</Route>
      </Switch>
    );
    const { location, rerenderNative } = renderNative(routes);

    expect(await screen.findByTestId('clerk-fallback-sign-in')).toBeTruthy();
    expect(screen.getByTestId('native-auth-mode').textContent).toBe('web-fallback');
    expect(screen.getByTestId('native-fallback-reason').textContent)
      .toBe('Native configure did not respond. Last native step: initialize called.');
    expect(screen.getByText(/Continue with your Corvlio email and password/)).toBeTruthy();
    expect(location.history?.at(-1)).toBe('/sign-in');
    expect(screen.queryByTestId('public-home')).toBeNull();

    const signInProps = mocks.signInProps.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(signInProps).toMatchObject({
      routing: 'virtual',
      signUpUrl: expect.stringMatching(/\/sign-up$/),
      forceRedirectUrl: expect.stringMatching(/\/dashboard$/),
    });
    expect(signInProps).not.toHaveProperty('path');

    const tokenGetter = mocks.setAuthTokenGetter.mock.calls.at(-1)?.[0] as (() => Promise<string | null>) | undefined;
    expect(tokenGetter).toBeTypeOf('function');
    await expect(tokenGetter?.()).resolves.toBe('session-token-test');

    mocks.webAuth = {
      user: {
        id: 'user_web_fallback',
        fullName: 'Web Fallback',
        firstName: 'Web',
        lastName: 'Fallback',
        primaryEmailAddress: { emailAddress: 'fallback@example.test' },
        emailAddresses: [{ emailAddress: 'fallback@example.test' }],
      },
      isLoaded: true,
      isSignedIn: true,
    };
    rerenderNative(routes);
    expect(await screen.findByText('Native dashboard')).toBeTruthy();
    expect(location.history?.at(-1)).toBe('/dashboard');
  });

  it('uses virtual routing for sign-up fallback and keeps the welcome redirect', async () => {
    mocks.initialize.mockRejectedValue(new Error('Native configure did not respond.'));
    renderNative(
      <Switch>
        <Route path="/sign-up"><NativeHostedSignInPage mode="signUp" /></Route>
      </Switch>,
      '/sign-up',
    );

    expect(await screen.findByTestId('clerk-fallback-sign-up')).toBeTruthy();
    const signUpProps = mocks.signUpProps.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(signUpProps).toMatchObject({
      routing: 'virtual',
      signInUrl: expect.stringMatching(/\/sign-in$/),
      forceRedirectUrl: expect.stringMatching(/\/welcome$/),
    });
    expect(signUpProps).not.toHaveProperty('path');
  });
});

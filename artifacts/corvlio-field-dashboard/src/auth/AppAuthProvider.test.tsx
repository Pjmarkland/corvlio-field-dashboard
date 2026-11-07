import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Router, Route, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  getAuthState: vi.fn(),
  startHostedAuth: vi.fn(),
  getToken: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('./nativeClerkAuth', () => ({
  nativeClerkAuth: mocks,
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
  const { isLoaded, isSignedIn, user, signOut } = useAppAuth();
  return (
    <div>
      <p data-testid="native-auth-state">
        {isLoaded ? (isSignedIn ? `signed-in:${user?.id}` : 'signed-out') : 'loading'}
      </p>
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
  mocks.startHostedAuth.mockResolvedValue(signedInState);
  mocks.getToken.mockResolvedValue({ token: 'session-token-test' });
  mocks.signOut.mockResolvedValue(signedOutState);
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

  it('restores a Keychain session on initialization and forwards sign-out', async () => {
    mocks.initialize.mockResolvedValue(signedInState);
    renderNative(<AuthProbe />, '/dashboard');

    expect(await screen.findByTestId('native-auth-state')).toHaveTextContent('signed-in:user_native_test');
    fireEvent.click(screen.getByText('Sign out in test'));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId('native-auth-state')).toHaveTextContent('signed-out'));
  });
});

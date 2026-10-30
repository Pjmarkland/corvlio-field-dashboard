import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Router, Switch } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { BusinessSetupGuard } from './BusinessSetupGuard';

const { useUser, useGetLeads, setupMounted, welcomeMounted, refetch } = vi.hoisted(() => ({
  useUser: vi.fn(), useGetLeads: vi.fn(), setupMounted: vi.fn(), welcomeMounted: vi.fn(), refetch: vi.fn(),
}));
vi.mock('@clerk/react', () => ({ useUser }));
vi.mock('@workspace/api-client-react', () => ({
  useGetLeads, getGetLeadsQueryKey: () => ['/api/leads'],
}));

function Setup() {
  setupMounted();
  return <form data-testid="setup-form">Set up your business</form>;
}
function Welcome() {
  welcomeMounted();
  return <div>Welcome to Corvlio</div>;
}
function flow(path: string) {
  const location = memoryLocation({ path, record: true });
  render(<Router hook={location.hook}><Switch>
    <Route path="/sign-in"><button onClick={() => {
      useUser.mockReturnValue({ isLoaded: true, isSignedIn: true, user: { id: 'existing-owner' } });
      location.navigate('/onboarding');
    }}>Sign in</button></Route>
    <Route path="/onboarding"><BusinessSetupGuard><Setup /></BusinessSetupGuard></Route>
    <Route path="/welcome"><BusinessSetupGuard><Welcome /></BusinessSetupGuard></Route>
    <Route path="/dashboard"><div>Existing business dashboard</div></Route>
  </Switch></Router>);
  return location;
}

beforeEach(() => {
  vi.clearAllMocks();
  useUser.mockReturnValue({ isLoaded: true, isSignedIn: true, user: { id: 'existing-owner' } });
  useGetLeads.mockReturnValue({
    data: { configured: true, businessName: 'Existing business', leads: [], retellPhoneNumber: null },
    isPending: false, isFetching: false, isError: false, refetch,
  });
});

describe('existing-owner setup routing', () => {
  it('an existing owner signs in and lands on the dashboard, even with an old onboarding return URL', async () => {
    useUser.mockReturnValue({ isLoaded: true, isSignedIn: false, user: null });
    flow('/sign-in');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Existing business dashboard')).toBeTruthy();
    expect(setupMounted).not.toHaveBeenCalled();
    expect(welcomeMounted).not.toHaveBeenCalled();
  });

  it.each(['/onboarding', '/welcome'])('redirects a configured owner from %s before any setup/welcome code mounts', async path => {
    flow(path);
    expect(await screen.findByText('Existing business dashboard')).toBeTruthy();
    expect(setupMounted).not.toHaveBeenCalled();
    expect(welcomeMounted).not.toHaveBeenCalled();
  });

  it('waits for authentication and business lookup instead of flashing setup', () => {
    useUser.mockReturnValue({ isLoaded: false, isSignedIn: undefined, user: null });
    useGetLeads.mockReturnValue({ isPending: true, isFetching: false });
    flow('/onboarding');
    expect(screen.getByRole('status').textContent).toContain('Checking your business');
    expect(setupMounted).not.toHaveBeenCalled();
    expect(useGetLeads.mock.calls.at(-1)?.[0].query.enabled).toBeFalsy();
  });

  it('does not display setup or welcome on a failed lookup and offers retry', () => {
    useGetLeads.mockReturnValue({ isPending: false, isFetching: false, isError: true, refetch });
    flow('/welcome');
    expect(screen.getByRole('alert').textContent).toContain('Setup is paused');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(welcomeMounted).not.toHaveBeenCalled();
    expect(setupMounted).not.toHaveBeenCalled();
  });

  it('allows setup only after the server explicitly confirms this account has no business', () => {
    useGetLeads.mockReturnValue({
      data: { configured: false, leads: [] }, isPending: false, isFetching: false, isError: false,
    });
    flow('/onboarding');
    expect(screen.getByTestId('setup-form')).toBeTruthy();
    expect(useGetLeads.mock.calls.at(-1)?.[0].query.queryKey).toEqual(['/api/leads', 'setup-entry', 'existing-owner']);
  });

  it('sends signed-out setup visitors to sign-in without looking up a business', async () => {
    useUser.mockReturnValue({ isLoaded: true, isSignedIn: false, user: null });
    flow('/onboarding');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy());
    expect(setupMounted).not.toHaveBeenCalled();
    expect(useGetLeads.mock.calls.at(-1)?.[0].query.enabled).toBe(false);
  });
});
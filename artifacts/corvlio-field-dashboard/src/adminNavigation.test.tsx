import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router, Route } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const state = vi.hoisted(() => ({
  signedIn: true,
  native: false,
  userId: 'admin-one',
  query: { isSuccess: true, isError: false },
  overview: vi.fn(),
}));
vi.mock('@clerk/react', () => ({
  useUser: () => ({ isSignedIn: state.signedIn, user: { id: state.userId } }),
  useClerk: () => ({ signOut: vi.fn() }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
  Show: () => null, SignIn: () => null, SignUp: () => null,
}));
vi.mock('@capacitor/core', async importOriginal => ({ ...await importOriginal<object>(), Capacitor: {
  isNativePlatform: () => state.native, getPlatform: () => state.native ? 'ios' : 'web',
} }));
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...await importOriginal<object>(),
  useGetAdminOverview: (options: unknown) => { state.overview(options); return state.query; },
  useGetBusinessProfile: () => ({ data: { isInternal: true, billingMode: 'manual' }, isSuccess: true }),
  useGetOwnerInvoices: () => ({ data: undefined }),
}));
vi.mock('@/hooks/useBilling', () => ({ useBillingAvailability: () => ({ enabled: false }) }));
vi.mock('@/components/LeadAlertBell', () => ({ LeadAlertBell: () => null }));

import { AppShell } from './App';
import { AdminShell } from './pages/admin/AdminShared';

function mount(path = '/dashboard') {
  const location = memoryLocation({ path });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><Router hook={location.hook}>
    <Route path="/dashboard"><AppShell leads={[]} businessName="Corvlio">Owner dashboard</AppShell></Route>
    <Route path="/admin"><AdminShell title="Overview" eyebrow="Founder">Founder overview</AdminShell></Route>
  </Router></QueryClientProvider>);
  return { ...view, location };
}

beforeEach(() => {
  state.signedIn = true; state.native = false; state.userId = 'admin-one';
  state.query = { isSuccess: true, isError: false }; state.overview.mockClear();
});
afterEach(cleanup);

describe('Admin dashboard switching', () => {
  it('uses the light-text asset for owner navigation while the sign-in page uses the dark-text asset', () => {
    mount();
    const ownerLogos = screen.getAllByRole('img', { name: 'Corvlio' });
    expect(ownerLogos).toHaveLength(2);
    expect(ownerLogos.every(image => image.getAttribute('src')?.includes('logo-light.png'))).toBe(true);
    expect(screen.getByTestId('link-mobile-brand').closest('header')?.className).toContain('bg-sidebar');
  });

  it('places Founder Console below Settings and supports switching both ways', () => {
    mount();
    const nav = screen.getByRole('navigation', { name: 'Primary navigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => link.textContent)).toEqual(['Today', 'Completed', 'Spam', 'Stats', 'Settings', 'Founder Console']);
    expect(links[5].getAttribute('href')).toBe('/admin');
    fireEvent.click(links[5]);
    expect(screen.getByTestId('link-admin-back-dashboard').getAttribute('href')).toBe('/dashboard');
    for (const [label, href] of [['Overview', '/admin'], ['Lead activity', '/admin/activity'], ['SMS alerts', '/admin/sms'], ['Invoices', '/admin/invoices'], ['Settings', '/admin/settings']]) {
      expect(within(screen.getByRole('navigation', { name: 'Founder console navigation' })).getByRole('link', { name: label }).getAttribute('href')).toBe(href);
    }
    expect(screen.getByTestId('link-admin-mobile-back-dashboard').getAttribute('href')).toBe('/dashboard');
    fireEvent.click(screen.getByTestId('link-admin-back-dashboard'));
    expect(screen.getByText('Owner dashboard')).toBeTruthy();
    expect(screen.getByTestId('link-mobile-founder console').getAttribute('href')).toBe('/admin');
  });

  it.each([
    ['non-admin (404)', false, true],
    ['pending authorization', false, false],
    ['failed refetch with stale success', true, true],
  ])('hides both switch links for %s', (_name, isSuccess, isError) => {
    state.query = { isSuccess, isError };
    const view = mount();
    expect(screen.queryByRole('link', { name: 'Founder Console' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Mobile navigation' }).classList.contains('grid-cols-5')).toBe(true);
    view.unmount();
    mount('/admin');
    expect(screen.queryByRole('link', { name: 'Back to dashboard' })).toBeNull();
  });

  it.each(['signed-out', 'native'])('does not query for access or show links when %s', mode => {
    state.signedIn = mode !== 'signed-out'; state.native = mode === 'native';
    mount();
    expect(state.overview.mock.calls[0][0].query.enabled).toBe(false);
    expect(screen.queryByRole('link', { name: 'Founder Console' })).toBeNull();
  });

  it('scopes the permission query to the signed-in identity', () => {
    const view = mount();
    expect(state.overview.mock.calls[0][0].query.queryKey.at(-1)).toBe('admin-one');
    view.unmount();
    state.userId = 'owner-two'; state.query = { isSuccess: false, isError: false };
    mount();
    expect(state.overview.mock.lastCall?.[0].query.queryKey.at(-1)).toBe('owner-two');
    expect(screen.queryByRole('link', { name: 'Founder Console' })).toBeNull();
  });
});

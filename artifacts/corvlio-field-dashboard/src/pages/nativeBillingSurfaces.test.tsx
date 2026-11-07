import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ native: false, availability: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('wouter', () => ({
  Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));
vi.mock('@/hooks/useBilling', () => ({ useBillingAvailability: m.availability }));
vi.mock('@/auth/AppAuthProvider', () => ({
  useAppAuth: () => ({
    user: null, isLoaded: true, isSignedIn: true, error: null,
    signOut: vi.fn(), startHostedAuth: vi.fn(),
  }),
}));
import TermsPage from './terms';
import ClientAgreementPage from './client-agreement';
import AdminBillingPage from './admin/AdminBillingPage';
beforeEach(() => { m.native = false; vi.clearAllMocks(); });
describe('native payment surfaces', () => {
  it('blocks direct native admin billing before any availability/content hooks', () => {
    m.native = true;
    render(<AdminBillingPage />);
    expect(screen.getByTestId('redirect').textContent).toBe('/dashboard');
    expect(m.availability).not.toHaveBeenCalled();
  });
  it.each([TermsPage, ClientAgreementPage])('omits product fee/payment copy in native legal pages', Page => {
    m.native = true;
    const { container } = render(<Page />);
    expect(container.textContent).not.toMatch(/fees and payment|setup fee|billed monthly|\$100|client owes fees|late payment/i);
  });
  it.each([TermsPage, ClientAgreementPage])('keeps web legal payment copy unchanged', Page => {
    const { container } = render(<Page />);
    expect(container.textContent).toMatch(/fees and payment/i);
  });
  it('includes SMS alert disclosures in the Terms without adding product-price copy to native legal pages', () => {
    m.native = true;
    const { container } = render(<TermsPage />);
    expect(screen.getByTestId('terms-sms-section').textContent).toMatch(/opt in during signup/i);
    expect(container.textContent).toMatch(/callers never receive texts/i);
    expect(container.textContent).toMatch(/reply STOP to opt out and HELP for help/i);
    expect(container.textContent).toMatch(/hello@corvlio.com/);
    expect(container.textContent).toMatch(/mobile numbers and SMS consent are never sold or shared/i);
    expect(container.textContent).not.toMatch(/\\$\\d/);
  });
});

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ native: false, availability: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => m.native } }));
vi.mock('wouter', () => ({
  Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));
vi.mock('@/hooks/useBilling', () => ({ useBillingAvailability: m.availability }));
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
});
